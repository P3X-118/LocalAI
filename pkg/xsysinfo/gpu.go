package xsysinfo

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/jaypipes/ghw"
	"github.com/jaypipes/ghw/pkg/gpu"
	"github.com/mudler/xlog"
)

// GPU vendor constants
const (
	VendorNVIDIA  = "nvidia"
	VendorAMD     = "amd"
	VendorIntel   = "intel"
	VendorVulkan  = "vulkan"
	VendorUnknown = "unknown"
)

// UnifiedMemoryDevices is a list of GPU device name patterns that use unified memory
// (shared with system RAM). When these devices are detected and report N/A for VRAM,
// we fall back to system RAM information.
var UnifiedMemoryDevices = []string{
	"NVIDIA GB10",
	"GB10",
	// Jetson iGPUs: share system RAM with CPU. nvidia-smi returns [N/A] for
	// memory queries (NVML doesn't support Tegra memory introspection), so we
	// must fall back to system RAM. Devices on JP6 report as "Orin (nvgpu)".
	"ORIN",
	"NVGPU",
	"TEGRA",
}

// GPUMemoryInfo contains real-time GPU memory usage information
type GPUMemoryInfo struct {
	Index        int     `json:"index"`
	Name         string  `json:"name"`
	Vendor       string  `json:"vendor"`
	TotalVRAM    uint64  `json:"total_vram"`    // Total VRAM in bytes
	UsedVRAM     uint64  `json:"used_vram"`     // Used VRAM in bytes
	FreeVRAM     uint64  `json:"free_vram"`     // Free VRAM in bytes
	UsagePercent float64 `json:"usage_percent"` // Memory usage as percentage (0-100)
	// UtilizationPercent is the GPU core/compute load (0-100). It is distinct
	// from UsagePercent (memory) and is nil when the device/driver does not
	// expose it (e.g. most desktop NVIDIA before this was wired, AMD/Intel).
	UtilizationPercent *float64 `json:"utilization_percent,omitempty"`
}

// GPUAggregateInfo contains aggregate GPU information across all GPUs
type GPUAggregateInfo struct {
	TotalVRAM    uint64  `json:"total_vram"`
	UsedVRAM     uint64  `json:"used_vram"`
	FreeVRAM     uint64  `json:"free_vram"`
	UsagePercent float64 `json:"usage_percent"`
	GPUCount     int     `json:"gpu_count"`
}

// AggregateMemoryInfo contains aggregate memory information (unified for GPU/RAM)
type AggregateMemoryInfo struct {
	TotalMemory  uint64  `json:"total_memory"`
	UsedMemory   uint64  `json:"used_memory"`
	FreeMemory   uint64  `json:"free_memory"`
	UsagePercent float64 `json:"usage_percent"`
	GPUCount     int     `json:"gpu_count"`
	// UtilizationPercent is the average GPU compute load across GPUs that
	// report it (0-100), or nil if none do.
	UtilizationPercent *float64 `json:"utilization_percent,omitempty"`
}

// ResourceInfo represents unified memory resource information
type ResourceInfo struct {
	Type      string              `json:"type"` // "gpu" or "ram"
	Available bool                `json:"available"`
	GPUs      []GPUMemoryInfo     `json:"gpus,omitempty"`
	RAM       *SystemRAMInfo      `json:"ram,omitempty"`
	Aggregate AggregateMemoryInfo `json:"aggregate"`
}

var (
	gpuCache     []*gpu.GraphicsCard
	gpuCacheOnce sync.Once
	gpuCacheErr  error
)

func GPUs() ([]*gpu.GraphicsCard, error) {
	gpuCacheOnce.Do(func() {
		gpu, err := ghw.GPU()
		if err != nil {
			gpuCacheErr = err
			return
		}
		gpuCache = gpu.GraphicsCards
	})

	return gpuCache, gpuCacheErr
}

func TotalAvailableVRAM() (uint64, error) {
	// First, try ghw library detection
	gpus, err := GPUs()
	if err == nil {
		var totalVRAM uint64
		for _, gpu := range gpus {
			if gpu != nil && gpu.Node != nil && gpu.Node.Memory != nil {
				if gpu.Node.Memory.TotalUsableBytes > 0 {
					totalVRAM += uint64(gpu.Node.Memory.TotalUsableBytes)
				}
			}
		}
		// If we got valid VRAM from ghw, return it
		if totalVRAM > 0 {
			return totalVRAM, nil
		}
	}

	// Fallback to binary-based detection via GetGPUMemoryUsage()
	// This works even when ghw dependencies are missing from the base image
	gpuMemoryInfo := GetGPUMemoryUsage()
	if len(gpuMemoryInfo) > 0 {
		var totalVRAM uint64
		for _, gpu := range gpuMemoryInfo {
			totalVRAM += gpu.TotalVRAM
		}
		if totalVRAM > 0 {
			xlog.Debug("VRAM detected via binary tools", "total_vram", totalVRAM)
			return totalVRAM, nil
		}
	}

	// No VRAM detected
	return 0, nil
}

func HasGPU(vendor string) bool {
	gpus, err := GPUs()
	if err != nil {
		return false
	}
	if vendor == "" {
		return len(gpus) > 0
	}
	for _, gpu := range gpus {
		if strings.Contains(gpu.String(), vendor) {
			return true
		}
	}
	return false
}

// DetectGPUVendor detects the GPU vendor using multiple methods with fallbacks.
// First tries ghw library, then falls back to binary detection.
// Returns vendor string (VendorNVIDIA, VendorAMD, VendorIntel, VendorVulkan) or empty string if not detected.
// Priority order: NVIDIA > AMD > Intel > Vulkan
func DetectGPUVendor() (string, error) {
	// First, try ghw library detection
	gpus, err := GPUs()
	if err == nil && len(gpus) > 0 {
		for _, gpu := range gpus {
			if gpu.DeviceInfo != nil && gpu.DeviceInfo.Vendor != nil {
				vendorName := strings.ToUpper(gpu.DeviceInfo.Vendor.Name)
				if strings.Contains(vendorName, strings.ToUpper(VendorNVIDIA)) {
					xlog.Debug("GPU vendor detected via ghw", "vendor", VendorNVIDIA)
					return VendorNVIDIA, nil
				}
				if strings.Contains(vendorName, strings.ToUpper(VendorAMD)) {
					xlog.Debug("GPU vendor detected via ghw", "vendor", VendorAMD)
					return VendorAMD, nil
				}
				if strings.Contains(vendorName, strings.ToUpper(VendorIntel)) {
					xlog.Debug("GPU vendor detected via ghw", "vendor", VendorIntel)
					return VendorIntel, nil
				}
			}
		}
	}

	// Fallback to binary detection (priority: NVIDIA > AMD > Intel > Vulkan)
	// Check for nvidia-smi
	if _, err := exec.LookPath("nvidia-smi"); err == nil {
		xlog.Debug("GPU vendor detected via binary", "vendor", VendorNVIDIA, "binary", "nvidia-smi")
		return VendorNVIDIA, nil
	}

	// Check for rocm-smi (AMD)
	if _, err := exec.LookPath("rocm-smi"); err == nil {
		xlog.Debug("GPU vendor detected via binary", "vendor", VendorAMD, "binary", "rocm-smi")
		return VendorAMD, nil
	}

	// Check for xpu-smi or intel_gpu_top (Intel)
	if _, err := exec.LookPath("xpu-smi"); err == nil {
		xlog.Debug("GPU vendor detected via binary", "vendor", VendorIntel, "binary", "xpu-smi")
		return VendorIntel, nil
	}
	if _, err := exec.LookPath("intel_gpu_top"); err == nil {
		xlog.Debug("GPU vendor detected via binary", "vendor", VendorIntel, "binary", "intel_gpu_top")
		return VendorIntel, nil
	}

	// Check for vulkaninfo (Vulkan - lowest priority as it can detect any GPU)
	if _, err := exec.LookPath("vulkaninfo"); err == nil {
		xlog.Debug("GPU vendor detected via binary", "vendor", VendorVulkan, "binary", "vulkaninfo")
		return VendorVulkan, nil
	}

	// No vendor detected
	return "", nil
}

// isUnifiedMemoryDevice checks if the given GPU name matches any known unified memory device
func isUnifiedMemoryDevice(gpuName string) bool {
	gpuNameUpper := strings.ToUpper(gpuName)
	for _, pattern := range UnifiedMemoryDevices {
		if strings.Contains(gpuNameUpper, strings.ToUpper(pattern)) {
			return true
		}
	}
	return false
}

// tegraGPULoadPaths are sysfs locations that expose the integrated GPU's
// compute load on NVIDIA Jetson (Tegra) boards. The value is per-mille
// (0-1000). Different L4T/JetPack releases and SoCs expose it at different
// paths, so we probe them in order. These are readable from inside
// containers because /sys is bind-mounted.
var tegraGPULoadPaths = []string{
	"/sys/devices/platform/gpu.0/load",
	"/sys/devices/platform/bus@0/17000000.gpu/load",
	"/sys/devices/gpu.0/load",
}

// tegraGPULoadGlobs cover boards whose GPU node MMIO address differs from the
// fixed paths above (e.g. Xavier/Nano use a different base address).
var tegraGPULoadGlobs = []string{
	"/sys/devices/platform/*.gpu/load",
	"/sys/devices/platform/bus@*/*.gpu/load",
}

// parseTegraLoad converts the raw contents of a Tegra GPU "load" sysfs node
// (per-mille, 0-1000) into a 0-100 percentage. Returns ok=false if the value
// cannot be parsed.
func parseTegraLoad(raw string) (float64, bool) {
	v, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, false
	}
	pct := float64(v) / 10.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return pct, true
}

// readTegraGPULoad returns the integrated GPU compute load (0-100) on a Jetson
// board, or ok=false if this is not a Tegra device / the node is unavailable.
func readTegraGPULoad() (float64, bool) {
	paths := append([]string{}, tegraGPULoadPaths...)
	for _, g := range tegraGPULoadGlobs {
		if matches, err := filepath.Glob(g); err == nil {
			paths = append(paths, matches...)
		}
	}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if pct, ok := parseTegraLoad(string(data)); ok {
			return pct, true
		}
	}
	return 0, false
}

// tegraDeviceName returns a friendly board name from the device tree
// (e.g. "NVIDIA Jetson AGX Orin"), falling back to a generic label.
func tegraDeviceName() string {
	if data, err := os.ReadFile("/proc/device-tree/model"); err == nil {
		// device-tree strings are NUL-terminated and may contain NULs.
		name := strings.TrimSpace(strings.ReplaceAll(string(data), "\x00", " "))
		if name != "" {
			return name
		}
	}
	return "NVIDIA Tegra iGPU"
}

// getTegraGPU detects an NVIDIA Jetson (Tegra) integrated GPU and reports real
// compute load from sysfs plus unified (system RAM) memory usage.
//
// This is required because on Tegra nvidia-smi returns [N/A] for memory and
// does not report GPU utilization at all, so the generic NVIDIA path would
// otherwise show the iGPU flat-lined at 0%.
func getTegraGPU() []GPUMemoryInfo {
	util, ok := readTegraGPULoad()
	if !ok {
		return nil // not a Jetson / sysfs node unavailable
	}

	info := GPUMemoryInfo{
		Index:              0,
		Name:               tegraDeviceName(),
		Vendor:             VendorNVIDIA,
		UtilizationPercent: &util,
	}

	// Tegra uses unified memory shared with the system, so RAM usage is the
	// most accurate proxy for "VRAM".
	if sysInfo, err := GetSystemRAMInfo(); err == nil {
		info.TotalVRAM = sysInfo.Total
		info.UsedVRAM = sysInfo.Used
		info.FreeVRAM = sysInfo.Free
		info.UsagePercent = sysInfo.UsagePercent
	} else {
		xlog.Debug("failed to get system RAM for Tegra unified memory", "error", err)
	}

	return []GPUMemoryInfo{info}
}

// GetGPUMemoryUsage returns real-time GPU memory usage for all detected GPUs.
// It tries multiple vendor-specific tools in order: NVIDIA, AMD, Intel, Vulkan.
// Returns an empty slice if no GPU monitoring tools are available.
func GetGPUMemoryUsage() []GPUMemoryInfo {
	var gpus []GPUMemoryInfo

	// NVIDIA Jetson (Tegra) integrated GPU: nvidia-smi cannot report memory or
	// utilization here, so read real compute load from sysfs first. When found,
	// it is the only GPU on the board, so return early and skip the generic
	// probes below (which would otherwise add a duplicate, flat-0% entry).
	if tegraGPUs := getTegraGPU(); len(tegraGPUs) > 0 {
		return tegraGPUs
	}

	// Try NVIDIA first
	nvidiaGPUs := getNVIDIAGPUMemory()
	if len(nvidiaGPUs) > 0 {
		gpus = append(gpus, nvidiaGPUs...)
	}

	// XXX: Note - I could not test this with AMD and Intel GPUs, so I'm not sure if it works and it was added with the help of AI.

	// Try AMD ROCm
	amdGPUs := getAMDGPUMemory()
	if len(amdGPUs) > 0 {
		// Adjust indices to continue from NVIDIA GPUs
		startIdx := len(gpus)
		for i := range amdGPUs {
			amdGPUs[i].Index = startIdx + i
		}
		gpus = append(gpus, amdGPUs...)
	}

	// Try Intel
	intelGPUs := getIntelGPUMemory()
	if len(intelGPUs) > 0 {
		startIdx := len(gpus)
		for i := range intelGPUs {
			intelGPUs[i].Index = startIdx + i
		}
		gpus = append(gpus, intelGPUs...)
	}

	// Try Vulkan as fallback for device detection (limited real-time data)
	if len(gpus) == 0 {
		vulkanGPUs := getVulkanGPUMemory()
		gpus = append(gpus, vulkanGPUs...)
	}

	return gpus
}

// GetGPUAggregateInfo returns aggregate GPU information across all GPUs
func GetGPUAggregateInfo() GPUAggregateInfo {
	gpus := GetGPUMemoryUsage()

	var aggregate GPUAggregateInfo
	aggregate.GPUCount = len(gpus)

	for _, gpu := range gpus {
		aggregate.TotalVRAM += gpu.TotalVRAM
		aggregate.UsedVRAM += gpu.UsedVRAM
		aggregate.FreeVRAM += gpu.FreeVRAM
	}

	if aggregate.TotalVRAM > 0 {
		aggregate.UsagePercent = float64(aggregate.UsedVRAM) / float64(aggregate.TotalVRAM) * 100
	}

	return aggregate
}

// IsJetson reports true if running on an NVIDIA Jetson (Tegra) host. nvidia-smi
// NVML memory queries are unsupported on Jetson iGPUs and return "[N/A]" --
// calling them may also disturb the iGPU runtime state in ways that break
// CUDA init for spawned subprocesses (observed on JP 6.2.1, driver 540.4.0).
func IsJetson() bool {
	if _, err := os.Stat("/etc/nv_tegra_release"); err == nil {
		return true
	}
	return false
}

// getNVIDIAGPUMemory queries NVIDIA GPUs using nvidia-smi
func getNVIDIAGPUMemory() []GPUMemoryInfo {
	// On Jetson, skip nvidia-smi entirely. NVML memory queries return [N/A]
	// and (anecdotally) may put the iGPU into a state that breaks subsequent
	// CUDA inits in spawned gRPC backends. Treat the iGPU as unified memory
	// and let the caller fall back to system RAM via UnifiedMemoryDevices.
	if IsJetson() {
		sysInfo, err := GetSystemRAMInfo()
		if err != nil {
			return nil
		}
		return []GPUMemoryInfo{{
			Index:        0,
			Name:         "Orin (nvgpu)",
			Vendor:       VendorNVIDIA,
			TotalVRAM:    sysInfo.Total,
			UsedVRAM:     sysInfo.Used,
			FreeVRAM:     sysInfo.Free,
			UsagePercent: 0,
		}}
	}
	// Check if nvidia-smi is available
	if _, err := exec.LookPath("nvidia-smi"); err != nil {
		return nil
	}

	cmd := exec.Command("nvidia-smi",
		"--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu",
		"--format=csv,noheader,nounits")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		xlog.Debug("nvidia-smi failed", "error", err, "stderr", stderr.String())
		return nil
	}

	var gpus []GPUMemoryInfo
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ", ")
		if len(parts) < 5 {
			continue
		}

		idx, _ := strconv.Atoi(strings.TrimSpace(parts[0]))
		name := strings.TrimSpace(parts[1])
		totalStr := strings.TrimSpace(parts[2])
		usedStr := strings.TrimSpace(parts[3])
		freeStr := strings.TrimSpace(parts[4])

		// utilization.gpu (GPU core/compute load) is optional: it is reported
		// on desktop NVIDIA GPUs but is [N/A] on unified-memory parts.
		var utilPtr *float64
		if len(parts) >= 6 {
			utilStr := strings.TrimSpace(parts[5])
			if utilStr != "" && utilStr != "[N/A]" {
				if u, err := strconv.ParseFloat(utilStr, 64); err == nil {
					utilPtr = &u
				}
			}
		}

		var totalBytes, usedBytes, freeBytes uint64
		var usagePercent float64

		// Check if memory values are N/A (unified memory devices like GB10)
		isNA := totalStr == "[N/A]" || usedStr == "[N/A]" || freeStr == "[N/A]"

		if isNA && isUnifiedMemoryDevice(name) {
			// Unified memory device - fall back to system RAM
			sysInfo, err := GetSystemRAMInfo()
			if err != nil {
				xlog.Debug("failed to get system RAM for unified memory device", "error", err, "device", name)
				// Still add the GPU but with zero memory info
				gpus = append(gpus, GPUMemoryInfo{
					Index:              idx,
					Name:               name,
					Vendor:             VendorNVIDIA,
					TotalVRAM:          0,
					UsedVRAM:           0,
					FreeVRAM:           0,
					UsagePercent:       0,
					UtilizationPercent: utilPtr,
				})
				continue
			}

			totalBytes = sysInfo.Total
			usedBytes = sysInfo.Used
			freeBytes = sysInfo.Free
			if totalBytes > 0 {
				usagePercent = float64(usedBytes) / float64(totalBytes) * 100
			}
		} else if isNA {
			// Unknown device with N/A values - skip memory info
			xlog.Debug("nvidia-smi returned N/A for unknown device", "device", name)
			gpus = append(gpus, GPUMemoryInfo{
				Index:              idx,
				Name:               name,
				Vendor:             VendorNVIDIA,
				TotalVRAM:          0,
				UsedVRAM:           0,
				FreeVRAM:           0,
				UsagePercent:       0,
				UtilizationPercent: utilPtr,
			})
			continue
		} else {
			// Normal GPU with dedicated VRAM
			totalMB, _ := strconv.ParseFloat(totalStr, 64)
			usedMB, _ := strconv.ParseFloat(usedStr, 64)
			freeMB, _ := strconv.ParseFloat(freeStr, 64)

			// Convert MB to bytes
			totalBytes = uint64(totalMB * 1024 * 1024)
			usedBytes = uint64(usedMB * 1024 * 1024)
			freeBytes = uint64(freeMB * 1024 * 1024)

			if totalBytes > 0 {
				usagePercent = float64(usedBytes) / float64(totalBytes) * 100
			}
		}

		gpus = append(gpus, GPUMemoryInfo{
			Index:              idx,
			Name:               name,
			Vendor:             VendorNVIDIA,
			TotalVRAM:          totalBytes,
			UsedVRAM:           usedBytes,
			FreeVRAM:           freeBytes,
			UsagePercent:       usagePercent,
			UtilizationPercent: utilPtr,
		})
	}

	return gpus
}

// getAMDGPUMemory queries AMD GPUs using rocm-smi
func getAMDGPUMemory() []GPUMemoryInfo {
	// Check if rocm-smi is available
	if _, err := exec.LookPath("rocm-smi"); err != nil {
		return nil
	}

	// Try CSV format first
	cmd := exec.Command("rocm-smi", "--showmeminfo", "vram", "--csv")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		xlog.Debug("rocm-smi failed", "error", err, "stderr", stderr.String())
		return nil
	}

	var gpus []GPUMemoryInfo
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")

	// Skip header line
	for i, line := range lines {
		if i == 0 || line == "" {
			continue
		}

		parts := strings.Split(line, ",")
		if len(parts) < 3 {
			continue
		}

		// Parse GPU index from first column (usually "GPU[0]" format)
		idxStr := strings.TrimSpace(parts[0])
		idx := 0
		if strings.HasPrefix(idxStr, "GPU[") {
			idxStr = strings.TrimPrefix(idxStr, "GPU[")
			idxStr = strings.TrimSuffix(idxStr, "]")
			idx, _ = strconv.Atoi(idxStr)
		}

		// Parse memory values (in bytes or MB depending on rocm-smi version)
		usedBytes, _ := strconv.ParseUint(strings.TrimSpace(parts[2]), 10, 64)
		totalBytes, _ := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64)

		// If values seem like MB, convert to bytes
		if totalBytes < 1000000 {
			usedBytes *= 1024 * 1024
			totalBytes *= 1024 * 1024
		}

		freeBytes := uint64(0)
		if totalBytes > usedBytes {
			freeBytes = totalBytes - usedBytes
		}

		usagePercent := 0.0
		if totalBytes > 0 {
			usagePercent = float64(usedBytes) / float64(totalBytes) * 100
		}

		gpus = append(gpus, GPUMemoryInfo{
			Index:        idx,
			Name:         "AMD GPU",
			Vendor:       VendorAMD,
			TotalVRAM:    totalBytes,
			UsedVRAM:     usedBytes,
			FreeVRAM:     freeBytes,
			UsagePercent: usagePercent,
		})
	}

	return gpus
}

// getIntelGPUMemory queries Intel GPUs using xpu-smi or intel_gpu_top
func getIntelGPUMemory() []GPUMemoryInfo {
	// Try xpu-smi first (Intel's official GPU management tool)
	gpus := getIntelXPUSMI()
	if len(gpus) > 0 {
		return gpus
	}

	// Fallback to intel_gpu_top
	return getIntelGPUTop()
}

// getIntelXPUSMI queries Intel GPUs using xpu-smi
func getIntelXPUSMI() []GPUMemoryInfo {
	if _, err := exec.LookPath("xpu-smi"); err != nil {
		return nil
	}

	// Get device list
	cmd := exec.Command("xpu-smi", "discovery", "--json")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		xlog.Debug("xpu-smi discovery failed", "error", err, "stderr", stderr.String())
		return nil
	}

	// Parse JSON output
	var result struct {
		DeviceList []struct {
			DeviceID                int    `json:"device_id"`
			DeviceName              string `json:"device_name"`
			VendorName              string `json:"vendor_name"`
			MemoryPhysicalSizeBytes uint64 `json:"memory_physical_size_byte"`
		} `json:"device_list"`
	}

	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		xlog.Debug("failed to parse xpu-smi discovery output", "error", err)
		return nil
	}

	var gpus []GPUMemoryInfo

	for _, device := range result.DeviceList {
		// Get memory usage for this device
		statsCmd := exec.Command("xpu-smi", "stats", "-d", strconv.Itoa(device.DeviceID), "--json")

		var statsStdout bytes.Buffer
		statsCmd.Stdout = &statsStdout

		usedBytes := uint64(0)
		if err := statsCmd.Run(); err == nil {
			var stats struct {
				DeviceID   int    `json:"device_id"`
				MemoryUsed uint64 `json:"memory_used"`
			}
			if err := json.Unmarshal(statsStdout.Bytes(), &stats); err == nil {
				usedBytes = stats.MemoryUsed
			}
		}

		totalBytes := device.MemoryPhysicalSizeBytes
		freeBytes := uint64(0)
		if totalBytes > usedBytes {
			freeBytes = totalBytes - usedBytes
		}

		usagePercent := 0.0
		if totalBytes > 0 {
			usagePercent = float64(usedBytes) / float64(totalBytes) * 100
		}

		gpus = append(gpus, GPUMemoryInfo{
			Index:        device.DeviceID,
			Name:         device.DeviceName,
			Vendor:       VendorIntel,
			TotalVRAM:    totalBytes,
			UsedVRAM:     usedBytes,
			FreeVRAM:     freeBytes,
			UsagePercent: usagePercent,
		})
	}

	return gpus
}

// getIntelGPUTop queries Intel GPUs using intel_gpu_top
func getIntelGPUTop() []GPUMemoryInfo {
	if _, err := exec.LookPath("intel_gpu_top"); err != nil {
		return nil
	}

	// intel_gpu_top with -J outputs JSON, -s 1 for single sample
	cmd := exec.Command("intel_gpu_top", "-J", "-s", "1")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		xlog.Debug("intel_gpu_top failed", "error", err, "stderr", stderr.String(), "stdout", stdout.String())
		return nil
	}

	// Parse JSON output - intel_gpu_top outputs NDJSON
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) == 0 {
		return nil
	}

	// Take the last complete JSON object
	var lastJSON string
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "{") {
			lastJSON = lines[i]
			break
		}
	}

	if lastJSON == "" {
		return nil
	}

	var result struct {
		Engines map[string]interface{} `json:"engines"`
		// Memory info if available
	}

	if err := json.Unmarshal([]byte(lastJSON), &result); err != nil {
		xlog.Debug("failed to parse intel_gpu_top output", "error", err)
		return nil
	}

	// intel_gpu_top doesn't always provide memory info
	// Return empty if we can't get useful data
	return nil
}

// GetResourceInfo returns GPU info if available, otherwise system RAM info
func GetResourceInfo() ResourceInfo {
	gpus := GetGPUMemoryUsage()

	if len(gpus) > 0 {
		// GPU available - aggregate from the GPUs we already fetched (avoids a
		// second probe) and average compute load across those that report it.
		var totalVRAM, usedVRAM, freeVRAM uint64
		var utilSum float64
		var utilCount int
		for _, g := range gpus {
			totalVRAM += g.TotalVRAM
			usedVRAM += g.UsedVRAM
			freeVRAM += g.FreeVRAM
			if g.UtilizationPercent != nil {
				utilSum += *g.UtilizationPercent
				utilCount++
			}
		}
		var usagePercent float64
		if totalVRAM > 0 {
			usagePercent = float64(usedVRAM) / float64(totalVRAM) * 100
		}
		var utilPtr *float64
		if utilCount > 0 {
			avg := utilSum / float64(utilCount)
			utilPtr = &avg
		}
		return ResourceInfo{
			Type:      "gpu",
			Available: true,
			GPUs:      gpus,
			RAM:       nil,
			Aggregate: AggregateMemoryInfo{
				TotalMemory:        totalVRAM,
				UsedMemory:         usedVRAM,
				FreeMemory:         freeVRAM,
				UsagePercent:       usagePercent,
				GPUCount:           len(gpus),
				UtilizationPercent: utilPtr,
			},
		}
	}

	// No GPU - fall back to system RAM
	ramInfo, err := GetSystemRAMInfo()
	if err != nil {
		xlog.Debug("failed to get system RAM info", "error", err)
		return ResourceInfo{
			Type:      "ram",
			Available: false,
			Aggregate: AggregateMemoryInfo{},
		}
	}

	return ResourceInfo{
		Type:      "ram",
		Available: true,
		GPUs:      nil,
		RAM:       ramInfo,
		Aggregate: AggregateMemoryInfo{
			TotalMemory:  ramInfo.Total,
			UsedMemory:   ramInfo.Used,
			FreeMemory:   ramInfo.Free,
			UsagePercent: ramInfo.UsagePercent,
			GPUCount:     0,
		},
	}
}

// GetResourceAggregateInfo returns aggregate memory info (GPU if available, otherwise RAM)
// This is used by the memory reclaimer to check memory usage
func GetResourceAggregateInfo() AggregateMemoryInfo {
	resourceInfo := GetResourceInfo()
	return resourceInfo.Aggregate
}

// getVulkanGPUMemory queries GPUs using vulkaninfo as a fallback
// Note: Vulkan provides memory heap info but not real-time usage
func getVulkanGPUMemory() []GPUMemoryInfo {
	if _, err := exec.LookPath("vulkaninfo"); err != nil {
		return nil
	}

	cmd := exec.Command("vulkaninfo", "--json")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		xlog.Debug("vulkaninfo failed", "error", err, "stderr", stderr.String())
		return nil
	}

	// Parse Vulkan JSON output
	var result struct {
		VkPhysicalDevices []struct {
			DeviceName                       string `json:"deviceName"`
			DeviceType                       string `json:"deviceType"`
			VkPhysicalDeviceMemoryProperties struct {
				MemoryHeaps []struct {
					Flags int    `json:"flags"`
					Size  uint64 `json:"size"`
				} `json:"memoryHeaps"`
			} `json:"VkPhysicalDeviceMemoryProperties"`
		} `json:"VkPhysicalDevices"`
	}

	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		xlog.Debug("failed to parse vulkaninfo output", "error", err)
		return nil
	}

	var gpus []GPUMemoryInfo

	for i, device := range result.VkPhysicalDevices {
		// Skip non-discrete/integrated GPUs if possible
		if device.DeviceType == "VK_PHYSICAL_DEVICE_TYPE_CPU" {
			continue
		}

		// Sum up device-local memory heaps
		var totalVRAM uint64
		for _, heap := range device.VkPhysicalDeviceMemoryProperties.MemoryHeaps {
			// Flag 1 = VK_MEMORY_HEAP_DEVICE_LOCAL_BIT
			if heap.Flags&1 != 0 {
				totalVRAM += heap.Size
			}
		}

		if totalVRAM == 0 {
			continue
		}

		gpus = append(gpus, GPUMemoryInfo{
			Index:        i,
			Name:         device.DeviceName,
			Vendor:       VendorVulkan,
			TotalVRAM:    totalVRAM,
			UsedVRAM:     0, // Vulkan doesn't provide real-time usage
			FreeVRAM:     totalVRAM,
			UsagePercent: 0,
		})
	}

	return gpus
}
