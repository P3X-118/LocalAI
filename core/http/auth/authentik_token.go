package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProviderAuthentik marks users mirrored from an Authentik service-account
// token — the fleet control plane. Kept distinct from ProviderOIDC (browser
// login) so the two never collide on (provider, subject).
const ProviderAuthentik = "authentik-token"

// Positive validations are cached briefly so we don't hit Authentik on every
// API request. A revoked/disabled token stops working within this window.
const authentikCacheTTL = 5 * time.Minute

type authentikCacheEntry struct {
	user   *User
	expiry time.Time
}

var (
	authentikCache   = map[string]authentikCacheEntry{}
	authentikCacheMu sync.RWMutex
)

// Shape of GET /api/v3/core/users/me/ (verified against the running Authentik's
// UserSelfSerializer: user.{username,name,is_active,is_superuser,groups[].name}).
type authentikMe struct {
	User struct {
		Username    string `json:"username"`
		Name        string `json:"name"`
		IsActive    bool   `json:"is_active"`
		IsSuperuser bool   `json:"is_superuser"`
		Groups      []struct {
			Name string `json:"name"`
		} `json:"groups"`
	} `json:"user"`
}

// ValidateAuthentikToken validates an Authentik API / service-account token
// against the Authentik control plane and resolves it to a local mirror User.
// This is how the LocalAI FLEET is governed by Authentik: an app presents its
// Authentik service-account token as the API Bearer, dex validates it (cached)
// and upserts a user keyed by the Authentik subject — so agent/collection
// ownership is consistent on every box and revocable centrally from Authentik.
// No-op (returns nil) when authentikURL is unset, leaving the existing session
// / user-API-key / legacy-key paths completely unaffected.
func ValidateAuthentikToken(db *gorm.DB, token, authentikURL string, adminGroups []string) *User {
	if authentikURL == "" || token == "" {
		return nil
	}

	authentikCacheMu.RLock()
	if e, ok := authentikCache[token]; ok && time.Now().Before(e.expiry) {
		u := e.user
		authentikCacheMu.RUnlock()
		return u
	}
	authentikCacheMu.RUnlock()

	me := fetchAuthentikMe(authentikURL, token)
	if me == nil || !me.User.IsActive || me.User.Username == "" {
		return nil
	}

	groups := make([]string, 0, len(me.User.Groups))
	for _, g := range me.User.Groups {
		groups = append(groups, g.Name)
	}
	role := RoleUser
	if me.User.IsSuperuser || groupsGrantAdmin(groups, adminGroups) {
		role = RoleAdmin
	}

	user := upsertAuthentikUser(db, me.User.Username, me.User.Name, role)
	if user == nil {
		return nil
	}

	authentikCacheMu.Lock()
	authentikCache[token] = authentikCacheEntry{user: user, expiry: time.Now().Add(authentikCacheTTL)}
	authentikCacheMu.Unlock()
	return user
}

func fetchAuthentikMe(authentikURL, token string) *authentikMe {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	url := strings.TrimRight(authentikURL, "/") + "/api/v3/core/users/me/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var me authentikMe
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return nil
	}
	return &me
}

// upsertAuthentikUser mirrors the Authentik identity into the local user table,
// keyed by (ProviderAuthentik, username). Authentik is the source of truth for
// service accounts, so role/status are reconciled to the current Authentik
// state on each refresh.
func upsertAuthentikUser(db *gorm.DB, username, name, role string) *User {
	var user User
	err := db.Where("provider = ? AND subject = ?", ProviderAuthentik, username).First(&user).Error
	if err == nil {
		changed := false
		if user.Role != role {
			user.Role = role
			changed = true
		}
		if user.Status != StatusActive {
			user.Status = StatusActive
			changed = true
		}
		if name != "" && user.Name != name {
			user.Name = name
			changed = true
		}
		if changed {
			db.Save(&user)
		}
		return &user
	}

	user = User{
		ID:       uuid.New().String(),
		Email:    username + "@svc.localai",
		Name:     name,
		Provider: ProviderAuthentik,
		Subject:  username,
		Role:     role,
		Status:   StatusActive,
	}
	if err := db.Create(&user).Error; err != nil {
		return nil
	}
	return &user
}
