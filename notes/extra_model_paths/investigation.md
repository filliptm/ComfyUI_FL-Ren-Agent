# Investigation: ComfyUI extra_model_paths.yaml Support

**Date**: 2025-10-27  
**Status**: Research Complete  
**Confidence**: HIGH  

## Problem Statement

The `comfy_*` tools in `backend/mcp_server.py` and `backend/comfy_tools.py` currently use hardcoded folder mappings for ComfyUI model directories. However, ComfyUI supports an `extra_model_paths.yaml` configuration file that allows users to specify custom model paths. Our tools should discover and use these paths for full compatibility with user configurations.

## Key Questions

1. **Where is extra_model_paths.yaml located?**
2. **What is its file format/structure?**
3. **How does ComfyUI load and use it?**
4. **Is there an API endpoint that exposes this configuration?**
5. **How can we integrate it into our comfy_tools?**

---

## Research Findings

### 1. File Location

**Primary Location**: `ComfyUI/extra_model_paths.yaml` (root of ComfyUI installation)

**Alternative Locations** (platform-specific):
- **Windows**: `%APPDATA%\ComfyUI\extra_model_paths.yaml` (`C:\Users\<Username>\AppData\Roaming\ComfyUI`)
- **Linux/Mac**: `~/.config/ComfyUI/extra_model_paths.yaml` (likely)

**Evidence**:
- Official docs: "Keep it in ComfyUI's root directory at ComfyUI/extra_model_paths.yaml"
- Community forum: "This lives in %APPDATA%\ComfyUI on Windows"
- Example file exists: `extra_model_paths.yaml.example` in ComfyUI root

**Sources**:
- https://docs.comfy.org/development/core-concepts/models
- https://forum.comfy.org/t/models-not-being-detected-even-though-yaml-has-dirs-added/1394

---

### 2. File Format/Structure

**Format**: YAML with nested configuration blocks

**Structure**:
```yaml
config_name:
    base_path: /path/to/base/directory
    model_type1: relative/path/to/model_type1/
    model_type2: relative/path/to/model_type2/
```

**Supported Model Types**:
- `checkpoints`
- `configs`
- `vae`
- `loras`
- `upscale_models`
- `embeddings`
- `hypernetworks`
- `controlnet`
- `clip`
- `clip_vision`
- `diffusion_models`
- `gligen`
- `custom_nodes`

**Multiple Paths** (using pipe `|`):
```yaml
config_name:
    base_path: /path/to/base/
    loras: |
         models/Lora
         models/LyCORIS
```

**Example Configuration**:
```yaml
a111:
    base_path: D:\stable-diffusion-webui\
    checkpoints: models/Stable-diffusion
    configs: models/Stable-diffusion
    vae: models/VAE
    loras: |
         models/Lora
         models/LyCORIS
    upscale_models: |
                  models/ESRGAN
                  models/RealESRGAN
                  models/SwinIR
    embeddings: embeddings
    hypernetworks: models/hypernetworks
    controlnet: models/ControlNet

comfyui:
     base_path: path/to/comfyui/
     is_default: true  # Optional: marks folders to list first
     checkpoints: models/checkpoints/
     clip: models/clip/
     clip_vision: models/clip_vision/
     configs: models/configs/
     controlnet: models/controlnet/
     diffusion_models: |
                  models/diffusion_models
                  models/unet
     embeddings: models/embeddings/
     loras: models/loras/
     upscale_models: models/upscale_models/
     vae: models/vae/
```

**Sources**:
- https://docs.comfy.org/development/core-concepts/models
- https://github.com/comfyanonymous/ComfyUI/blob/master/extra_model_paths.yaml.example

---

### 3. How ComfyUI Loads and Uses It

**Loading Process**:
1. ComfyUI reads the file during startup (if it exists)
2. Parses YAML configuration blocks
3. Resolves paths (absolute or relative to base_path)
4. Merges with default paths in `folder_names_and_paths` global variable
5. Requires restart for changes to take effect

**Implementation Location**: 
- `main.py` loads `extra_model_paths_config` properly
- `folder_paths.py` contains the path resolution logic

**Known Issue** (GitHub #6039):
- `folder_paths.py` doesn't include extra_model_paths when used as a backend (without main.py)
- This affects programmatic usage of ComfyUI
- The `folder_names_and_paths` global variable should contain merged paths but doesn't always

**Key Functions** (from issue analysis):
- `folder_paths.get_full_path(folder_name: str, filename: str)` - Returns full path to model
- `folder_paths.get_full_path_or_raise()` - Raises FileNotFoundError if not found
- Both rely on `folder_names_and_paths` global variable

**Sources**:
- https://github.com/comfyanonymous/ComfyUI/issues/6039
- https://docs.comfy.org/development/core-concepts/models

---

### 4. API Endpoints

**Finding**: **NO API ENDPOINTS EXIST**

**Evidence**:
- Official docs: No mention of API endpoints for extra_model_paths configuration
- GitHub issues: Users discuss file-based configuration only
- All sources indicate this is a **startup configuration file** only

**Implications**:
- Configuration is loaded at startup and cached in memory
- No runtime API to query or modify extra paths
- Must read the YAML file directly from filesystem
- Changes require ComfyUI restart

**Sources**:
- https://docs.comfy.org/development/core-concepts/models
- https://github.com/comfyanonymous/ComfyUI/issues/6039
- https://github.com/comfyanonymous/ComfyUI/issues/8001

---

### 5. Integration Strategy

**Current State** (`backend/comfy_tools.py`):
```python
self.folder_mappings = {
    ComfyFolderType.CUSTOM_NODES: "custom_nodes",
    ComfyFolderType.MODELS: "models",
    ComfyFolderType.CHECKPOINTS: "models/checkpoints",
    ComfyFolderType.LORAS: "models/loras",
    ComfyFolderType.VAE: "models/vae",
    # ... hardcoded paths
}
```

**Proposed Enhancement**:

1. **Add YAML parsing capability**:
   ```python
   import yaml
   
   def _load_extra_model_paths(self) -> Dict[str, List[str]]:
       """Load and parse extra_model_paths.yaml if it exists."""
       yaml_locations = [
           self.comfyui_root / "extra_model_paths.yaml",
           # Platform-specific fallbacks
       ]
       # Parse and return merged paths
   ```

2. **Merge with default paths**:
   ```python
   def _build_folder_mappings(self) -> Dict[ComfyFolderType, List[str]]:
       """Build folder mappings from defaults + extra_model_paths.yaml."""
       # Start with defaults
       mappings = self._get_default_mappings()
       # Merge extra paths
       extra_paths = self._load_extra_model_paths()
       # Return combined
   ```

3. **Update list_folders to search multiple paths**:
   ```python
   def list_folders(self, folder_type: ComfyFolderType) -> List[ComfyFileInfo]:
       """List files from all configured paths for folder_type."""
       all_items = []
       for path in self.folder_mappings[folder_type]:
           all_items.extend(self._scan_directory(path))
       return all_items
   ```

4. **Handle multiple path syntax** (pipe-separated):
   ```python
   def _parse_yaml_paths(self, yaml_value: str, base_path: Path) -> List[Path]:
       """Parse YAML path value (handles pipe-separated multiple paths)."""
       if '|' in yaml_value:
           # Split and resolve each path
           return [base_path / p.strip() for p in yaml_value.split('|')]
       else:
           return [base_path / yaml_value.strip()]
   ```

**Benefits**:
- Full compatibility with user's ComfyUI configuration
- Discover models in custom locations automatically
- Support shared model libraries (A1111 + ComfyUI)
- No duplicate model downloads needed

**Challenges**:
- YAML parsing dependency (PyYAML)
- Multiple path handling complexity
- Platform-specific path resolution
- Need to handle missing/malformed YAML gracefully

---

## Conclusions

### Summary

1. **File exists**: `ComfyUI/extra_model_paths.yaml` (with platform-specific fallbacks)
2. **Format**: YAML with config blocks, base_path + relative paths, pipe-separated for multiple
3. **Loading**: Startup only, cached in memory, no runtime API
4. **No API**: Must read YAML directly from filesystem
5. **Integration needed**: Parse YAML, merge with defaults, handle multiple paths

### Confidence Level: **HIGH**

- Multiple authoritative sources (official docs, GitHub issues, community)
- Consistent information across sources
- Clear examples and file format
- Known limitations documented (no API, startup-only)

### Next Steps

**Should we proceed with implementation?**

Yes, this is a valuable enhancement:

1. **High user value**: Respects existing ComfyUI configuration
2. **Clear implementation path**: YAML parsing + path merging
3. **Low risk**: Graceful fallback to defaults if YAML missing/invalid
4. **Better UX**: Discovers all user's models automatically

**Implementation tasks**:

1. Add PyYAML dependency
2. Implement `_load_extra_model_paths()` method
3. Update `folder_mappings` to support multiple paths per type
4. Modify `list_folders()` to search all paths
5. Add error handling for malformed YAML
6. Test with various configurations (single path, multiple paths, missing file)
7. Update tool descriptions to mention extra_model_paths support

**Estimated complexity**: **Medium** (2-4 hours)

---

## References

### Official Documentation
- [ComfyUI Models Documentation](https://docs.comfy.org/development/core-concepts/models)
- [ComfyUI Community Manual](https://blenderneko.github.io/ComfyUI-docs/)

### GitHub Issues
- [#6039: folder_paths.py doesn't include extra_model_paths](https://github.com/comfyanonymous/ComfyUI/issues/6039)
- [#8001: Error with extra_model_paths.yaml](https://github.com/comfyanonymous/ComfyUI/issues/8001)

### Community Resources
- [ComfyUI Forum: Models not detected](https://forum.comfy.org/t/models-not-being-detected-even-though-yaml-has-dirs-added/1394)
- [Reddit: extra_model_paths.yaml for ComfyUI](https://www.reddit.com/r/StableDiffusion/comments/1896top/extra_model_pathsyaml_for_comfy_ui/)

### Example Files
- [extra_model_paths.yaml.example](https://github.com/comfyanonymous/ComfyUI/blob/master/extra_model_paths.yaml.example)
