package auth

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"

	StatusActive   = "active"
	StatusPending  = "pending"
	StatusDisabled = "disabled"
)

// AssignRole determines the role for a new user.
// First user in the database becomes admin. If adminEmail is set and matches,
// the user becomes admin. Otherwise, the user gets the "user" role.
// Must be called within a transaction that also creates the user to prevent
// race conditions on the first-user admin assignment.
func AssignRole(tx *gorm.DB, email, adminEmail string) string {
	var count int64
	tx.Model(&User{}).Count(&count)
	if count == 0 {
		return RoleAdmin
	}

	if adminEmail != "" && strings.EqualFold(email, adminEmail) {
		return RoleAdmin
	}

	return RoleUser
}

// MaybePromote promotes a user to admin on login if their email matches
// adminEmail. It does not demote existing admins. Returns true if the user
// was promoted.
func MaybePromote(db *gorm.DB, user *User, adminEmail string) bool {
	if user.Role == RoleAdmin {
		return false
	}

	if adminEmail != "" && strings.EqualFold(user.Email, adminEmail) {
		user.Role = RoleAdmin
		db.Model(user).Update("role", RoleAdmin)
		return true
	}

	return false
}

// groupsGrantAdmin reports whether any of the user's OIDC groups is in the
// configured admin-group allowlist (case-insensitive). This is how an external
// IdP (e.g. Authentik) drives dex roles: membership in a group like "sgc-admins"
// grants the admin role, so RBAC is managed centrally in the IdP instead of a
// single hard-coded admin email.
func groupsGrantAdmin(userGroups, adminGroups []string) bool {
	if len(userGroups) == 0 || len(adminGroups) == 0 {
		return false
	}
	for _, ag := range adminGroups {
		ag = strings.TrimSpace(ag)
		if ag == "" {
			continue
		}
		for _, ug := range userGroups {
			if strings.EqualFold(strings.TrimSpace(ug), ag) {
				return true
			}
		}
	}
	return false
}

// MaybePromoteByGroups promotes a user to admin on login when any of their OIDC
// groups is in the admin-group allowlist. Promote-only (never demotes), mirroring
// MaybePromote — an IdP group removal is reconciled by an explicit admin action,
// never a silent lockout. Returns true if the user was promoted.
func MaybePromoteByGroups(db *gorm.DB, user *User, userGroups, adminGroups []string) bool {
	if user.Role == RoleAdmin {
		return false
	}
	if groupsGrantAdmin(userGroups, adminGroups) {
		user.Role = RoleAdmin
		db.Model(user).Update("role", RoleAdmin)
		return true
	}
	return false
}

// ValidateInvite checks that an invite code exists, is unused, and has not expired.
// The code is hashed with HMAC-SHA256 before lookup.
func ValidateInvite(db *gorm.DB, code, hmacSecret string) (*InviteCode, error) {
	hash := HashAPIKey(code, hmacSecret)
	var invite InviteCode
	if err := db.Where("code = ?", hash).First(&invite).Error; err != nil {
		return nil, fmt.Errorf("invite code not found")
	}
	if invite.UsedBy != nil {
		return nil, fmt.Errorf("invite code already used")
	}
	if time.Now().After(invite.ExpiresAt) {
		return nil, fmt.Errorf("invite code expired")
	}
	return &invite, nil
}

// ConsumeInvite marks an invite code as used by the given user.
func ConsumeInvite(db *gorm.DB, invite *InviteCode, userID string) {
	now := time.Now()
	invite.UsedBy = &userID
	invite.UsedAt = &now
	db.Save(invite)
}

// NeedsInviteOrApproval returns true if registration gating applies for the given mode.
// Admins (first user or matching adminEmail) are never gated.
// Must be called within a transaction that also creates the user.
func NeedsInviteOrApproval(tx *gorm.DB, email, adminEmail, registrationMode string) bool {
	// Empty registration mode defaults to "approval"
	if registrationMode == "" {
		registrationMode = "approval"
	}
	if registrationMode != "approval" && registrationMode != "invite" {
		return false
	}
	// Admin email is never gated
	if adminEmail != "" && strings.EqualFold(email, adminEmail) {
		return false
	}
	// First user is never gated
	var count int64
	tx.Model(&User{}).Count(&count)
	if count == 0 {
		return false
	}
	return true
}
