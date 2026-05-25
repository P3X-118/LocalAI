package xsysinfo

import "testing"

func TestParseTegraLoad(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want float64
		ok   bool
	}{
		{"busy under load", "998\n", 99.8, true},
		{"idle", "0", 0, true},
		{"full", "1000", 100, true},
		{"overflow clamps to 100", "1200", 100, true},
		{"leading/trailing whitespace", "  500 \n", 50, true},
		{"empty", "", 0, false},
		{"non-numeric", "n/a", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseTegraLoad(tc.raw)
			if ok != tc.ok {
				t.Fatalf("parseTegraLoad(%q) ok = %v, want %v", tc.raw, ok, tc.ok)
			}
			if ok && got != tc.want {
				t.Fatalf("parseTegraLoad(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}
