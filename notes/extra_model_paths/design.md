# Design: Modular Extra Model Paths Integration

**Date**: 2025-10-27  
**Status**: Design Phase  
**Mode**: Design  

## Design Goals

1. **Modular**: Separate concerns - YAML parsing, path resolution, path merging
2. **No Code Duplication**: Single source of truth for model path discovery
3. **Backward Compatible**: Default paths work if YAML doesn't exist
4. **Extensible**: Easy to add new model types or path sources
5. **Testable**: Each component can be tested independently
6. **Minimal Changes**: Preserve existing API surface

---

## Architecture Overview

```mermaid
graph TB
    A[ComfyUITools.__init__] --> B[ExtraModelPathsLoader]
    B --> C[_find_yaml_file]
    B --> D[_parse_yaml]
    B --> E[_resolve_paths]
    E --> F[PathResolver]
    F --> G[folder_mappings: Dict[Type, List[Path]]]
    
    H[list_folders] --> G
    I[search_files] --> G
    
    style B fill:#e1f5ff
    style F fill:#e1f5ff
    style G fill:#ffe1e1
```

### Component Breakdown

1. **ExtraModelPathsLoader** (new module: `backend/extra_model_paths_loader.py`)
   - Finds YAML file in expected locations
   - Parses YAML with error handling
   - Returns structured data (not yet resolved)

2. **PathResolver** (new module: `backend/path_resolver.py`)
   - Resolves base_path + relative paths
   - Handles pipe-separated multiple paths
   - Validates paths exist and are accessible
   - Merges with default paths

3. **ComfyUITools** (modified: `backend/comfy_tools.py`)
   - Uses ExtraModelPathsLoader + PathResolver
   - Changes `folder_mappings` from `Dict[Type, str]` to `Dict[Type, List[Path]]`
   - Updates `list_folders()` to iterate over multiple paths
   - Updates `search_files()` to iterate over multiple paths

---

## Detailed Design

### 1. ExtraModelPathsLoader Module

**File**: `backend/extra_model_paths_loader.py`

```python
"""Loader for ComfyUI extra_model_paths.yaml configuration.

Provides parsing and validation of ComfyUI's extra model paths
configuration file without path resolution.
"""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
import yaml

logger = logging.getLogger(__name__)


class ExtraModelPathsConfig:
    """Structured representation of extra_model_paths.yaml."""
    
    def __init__(self, config_name: str, base_path: str, paths: Dict[str, str]):
        """Initialize config block.
        
        Args:
            config_name: Name of the config block (e.g., 'a111', 'comfyui')
            base_path: Base path for relative path resolution
            paths: Dict of model_type -> path_value (may contain pipes)
        """
        self.config_name = config_name
        self.base_path = base_path
        self.paths = paths
        self.is_default = paths.get('is_default', False)
    
    def __repr__(self):
        return f"ExtraModelPathsConfig(name={self.config_name}, base={self.base_path}, types={len(self.paths)})"


class ExtraModelPathsLoader:
    """Loads and parses extra_model_paths.yaml configuration."""
    
    YAML_FILENAME = "extra_model_paths.yaml"
    YAML_EXAMPLE_FILENAME = "extra_model_paths.yaml.example"
    
    def __init__(self, comfyui_root: Path):
        """Initialize loader.
        
        Args:
            comfyui_root: Path to ComfyUI installation root
        """
        self.comfyui_root = comfyui_root
    
    def find_yaml_file(self) -> Optional[Path]:
        """Find extra_model_paths.yaml in expected locations.
        
        Returns:
            Path to YAML file if found, None otherwise
        """
        # Priority order:
        locations = [
            # 1. ComfyUI root directory
            self.comfyui_root / self.YAML_FILENAME,
            
            # 2. Platform-specific config directories
            self._get_platform_config_path(),
            
            # 3. Environment variable override
            self._get_env_config_path(),
        ]
        
        for location in locations:
            if location and location.exists() and location.is_file():
                logger.info(f"Found extra_model_paths.yaml at: {location}")
                return location
        
        logger.debug("No extra_model_paths.yaml found")
        return None
    
    def _get_platform_config_path(self) -> Optional[Path]:
        """Get platform-specific config directory path."""
        if os.name == 'nt':  # Windows
            appdata = os.getenv('APPDATA')
            if appdata:
                return Path(appdata) / "ComfyUI" / self.YAML_FILENAME
        else:  # Linux/Mac
            home = Path.home()
            return home / ".config" / "ComfyUI" / self.YAML_FILENAME
        return None
    
    def _get_env_config_path(self) -> Optional[Path]:
        """Get path from environment variable."""
        env_path = os.getenv('COMFYUI_EXTRA_MODEL_PATHS')
        if env_path:
            return Path(env_path)
        return None
    
    def load(self) -> List[ExtraModelPathsConfig]:
        """Load and parse extra_model_paths.yaml.
        
        Returns:
            List of ExtraModelPathsConfig objects (one per config block)
            Empty list if file not found or parsing fails
        """
        yaml_path = self.find_yaml_file()
        if not yaml_path:
            return []
        
        try:
            return self._parse_yaml(yaml_path)
        except Exception as e:
            logger.error(f"Failed to parse {yaml_path}: {e}")
            return []
    
    def _parse_yaml(self, yaml_path: Path) -> List[ExtraModelPathsConfig]:
        """Parse YAML file into structured configs.
        
        Args:
            yaml_path: Path to YAML file
            
        Returns:
            List of ExtraModelPathsConfig objects
            
        Raises:
            yaml.YAMLError: If YAML is malformed
            ValueError: If required fields missing
        """
        with open(yaml_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        if not data or not isinstance(data, dict):
            logger.warning(f"Empty or invalid YAML structure in {yaml_path}")
            return []
        
        configs = []
        for config_name, config_data in data.items():
            if not isinstance(config_data, dict):
                logger.warning(f"Skipping invalid config block: {config_name}")
                continue
            
            # Extract base_path (required)
            base_path = config_data.get('base_path')
            if not base_path:
                logger.warning(f"Config '{config_name}' missing base_path, skipping")
                continue
            
            # Extract all other keys as model type paths
            paths = {k: v for k, v in config_data.items() if k != 'base_path'}
            
            configs.append(ExtraModelPathsConfig(
                config_name=config_name,
                base_path=base_path,
                paths=paths
            ))
        
        logger.info(f"Loaded {len(configs)} config blocks from {yaml_path}")
        return configs
```

---

### 2. PathResolver Module

**File**: `backend/path_resolver.py`

```python
"""Path resolution and merging for ComfyUI model paths.

Handles resolving base_path + relative paths, pipe-separated multiple paths,
and merging with default paths.
"""

import logging
from pathlib import Path
from typing import Dict, List, Set
from comfy_models import ComfyFolderType
from extra_model_paths_loader import ExtraModelPathsConfig

logger = logging.getLogger(__name__)


class PathResolver:
    """Resolves and merges ComfyUI model paths."""
    
    # Mapping from YAML keys to ComfyFolderType enum
    YAML_KEY_TO_FOLDER_TYPE = {
        'checkpoints': ComfyFolderType.CHECKPOINTS,
        'loras': ComfyFolderType.LORAS,
        'vae': ComfyFolderType.VAE,
        'controlnet': ComfyFolderType.CONTROLNET,
        'upscale_models': ComfyFolderType.UPSCALE_MODELS,
        'embeddings': ComfyFolderType.EMBEDDINGS,
        'custom_nodes': ComfyFolderType.CUSTOM_NODES,
        # Add more mappings as needed
        'clip': None,  # Not in our enum yet
        'clip_vision': None,
        'configs': None,
        'diffusion_models': None,
        'hypernetworks': None,
        'gligen': None,
    }
    
    def __init__(self, comfyui_root: Path):
        """Initialize resolver.
        
        Args:
            comfyui_root: ComfyUI installation root for validation
        """
        self.comfyui_root = comfyui_root
    
    def get_default_mappings(self) -> Dict[ComfyFolderType, List[Path]]:
        """Get default folder mappings.
        
        Returns:
            Dict mapping folder types to default paths (as single-item lists)
        """
        return {
            ComfyFolderType.CUSTOM_NODES: [self.comfyui_root / "custom_nodes"],
            ComfyFolderType.MODELS: [self.comfyui_root / "models"],
            ComfyFolderType.CHECKPOINTS: [self.comfyui_root / "models" / "checkpoints"],
            ComfyFolderType.LORAS: [self.comfyui_root / "models" / "loras"],
            ComfyFolderType.VAE: [self.comfyui_root / "models" / "vae"],
            ComfyFolderType.CONTROLNET: [self.comfyui_root / "models" / "controlnet"],
            ComfyFolderType.UPSCALE_MODELS: [self.comfyui_root / "models" / "upscale_models"],
            ComfyFolderType.EMBEDDINGS: [self.comfyui_root / "models" / "embeddings"],
            ComfyFolderType.OUTPUT: [self.comfyui_root / "output"],
            ComfyFolderType.INPUT: [self.comfyui_root / "input"],
            ComfyFolderType.TEMP: [self.comfyui_root / "temp"],
            ComfyFolderType.WORKFLOWS: [self.comfyui_root / "user" / "default" / "workflows"],
        }
    
    def merge_with_extra_paths(
        self,
        default_mappings: Dict[ComfyFolderType, List[Path]],
        extra_configs: List[ExtraModelPathsConfig]
    ) -> Dict[ComfyFolderType, List[Path]]:
        """Merge default paths with extra_model_paths.yaml configs.
        
        Args:
            default_mappings: Default folder mappings
            extra_configs: Parsed extra_model_paths configs
            
        Returns:
            Merged mappings with extra paths prepended (or appended based on is_default)
        """
        if not extra_configs:
            return default_mappings
        
        # Start with defaults
        merged = {k: list(v) for k, v in default_mappings.items()}
        
        # Process each config block
        for config in extra_configs:
            base_path = Path(config.base_path)
            
            # Resolve each model type path
            for yaml_key, path_value in config.paths.items():
                # Skip metadata keys
                if yaml_key in ('is_default',):
                    continue
                
                # Map YAML key to folder type
                folder_type = self.YAML_KEY_TO_FOLDER_TYPE.get(yaml_key)
                if folder_type is None:
                    logger.debug(f"Skipping unmapped YAML key: {yaml_key}")
                    continue
                
                # Parse path value (handle pipe-separated multiple paths)
                resolved_paths = self._resolve_path_value(base_path, path_value)
                
                # Validate paths exist
                valid_paths = [p for p in resolved_paths if self._validate_path(p)]
                
                if not valid_paths:
                    logger.warning(
                        f"No valid paths found for {yaml_key} in config '{config.config_name}'"
                    )
                    continue
                
                # Add to merged mappings
                if folder_type not in merged:
                    merged[folder_type] = []
                
                # Prepend extra paths (they take priority)
                for path in valid_paths:
                    if path not in merged[folder_type]:
                        merged[folder_type].insert(0, path)
                
                logger.debug(
                    f"Added {len(valid_paths)} path(s) for {folder_type.value} "
                    f"from config '{config.config_name}'"
                )
        
        return merged
    
    def _resolve_path_value(self, base_path: Path, path_value: str) -> List[Path]:
        """Resolve a path value from YAML (handles pipe-separated multiple paths).
        
        Args:
            base_path: Base path for relative resolution
            path_value: Path value from YAML (may contain pipes)
            
        Returns:
            List of resolved absolute paths
        """
        # Handle pipe-separated multiple paths
        if '|' in path_value:
            raw_paths = [p.strip() for p in path_value.split('|') if p.strip()]
        else:
            raw_paths = [path_value.strip()]
        
        resolved = []
        for raw_path in raw_paths:
            path = Path(raw_path)
            
            # If relative, resolve against base_path
            if not path.is_absolute():
                path = base_path / path
            
            # Resolve symlinks and normalize
            try:
                path = path.resolve()
                resolved.append(path)
            except (OSError, RuntimeError) as e:
                logger.warning(f"Failed to resolve path '{raw_path}': {e}")
                continue
        
        return resolved
    
    def _validate_path(self, path: Path) -> bool:
        """Validate that a path exists and is accessible.
        
        Args:
            path: Path to validate
            
        Returns:
            True if path exists and is accessible, False otherwise
        """
        try:
            return path.exists() and path.is_dir()
        except (OSError, PermissionError) as e:
            logger.debug(f"Path validation failed for {path}: {e}")
            return False
```

---

### 3. ComfyUITools Modifications

**File**: `backend/comfy_tools.py`

**Changes**:

1. **Import new modules**:
```python
from extra_model_paths_loader import ExtraModelPathsLoader
from path_resolver import PathResolver
```

2. **Update `__init__` to use new loaders**:
```python
def __init__(self, comfyui_root: Optional[str] = None, comfy_url: str = "http://127.0.0.1:8188"):
    # ... existing validation ...
    
    # Load extra model paths
    loader = ExtraModelPathsLoader(self.comfyui_root)
    extra_configs = loader.load()
    
    # Resolve and merge paths
    resolver = PathResolver(self.comfyui_root)
    default_mappings = resolver.get_default_mappings()
    self.folder_mappings = resolver.merge_with_extra_paths(default_mappings, extra_configs)
    
    # Log summary
    logger.info(f"Loaded folder mappings for {len(self.folder_mappings)} folder types")
    for folder_type, paths in self.folder_mappings.items():
        logger.debug(f"  {folder_type.value}: {len(paths)} path(s)")
```

3. **Update `list_folders()` to handle multiple paths**:
```python
def list_folders(
    self,
    folder_type: Union[str, ComfyFolderType],
    pattern: Optional[str] = None,
    sort_by: Optional[str] = None,
    order: str = "asc",
    limit: int = 50
) -> List[ComfyFileInfo]:
    # ... existing validation ...
    
    # Get all paths for this folder type
    folder_paths = self.folder_mappings.get(folder_type, [])
    
    if not folder_paths:
        raise ComfyUIError(f"Unknown folder type: {folder_type}")
    
    # Collect items from all paths
    all_items = []
    seen_names = set()  # Deduplicate by name
    
    for folder_path in folder_paths:
        if not folder_path.exists():
            logger.debug(f"Skipping non-existent path: {folder_path}")
            continue
        
        for entry in folder_path.iterdir():
            # Skip duplicates (same filename in multiple paths)
            if entry.name in seen_names:
                logger.debug(f"Skipping duplicate: {entry.name}")
                continue
            
            seen_names.add(entry.name)
            
            try:
                stat = entry.stat()
                relative_path = str(entry.relative_to(self.comfyui_root))
                
                all_items.append(ComfyFileInfo(
                    name=entry.name,
                    path=relative_path,
                    is_directory=entry.is_dir(),
                    size=stat.st_size if entry.is_file() else None,
                    modified_time=stat.st_mtime,
                    extension=entry.suffix[1:] if entry.suffix else None
                ))
            except (OSError, PermissionError) as e:
                logger.warning(f"Cannot access {entry}: {e}")
                continue
    
    # ... existing filtering, sorting, limiting ...
    return all_items
```

4. **Update `search_files()` to handle multiple paths**:
```python
def search_files(
    self,
    pattern: str,
    folder_type: Union[str, ComfyFolderType] = ComfyFolderType.CUSTOM_NODES,
    file_pattern: Optional[str] = None,
    max_results: int = 20,
    context_lines: int = 2
) -> List[ComfySearchResult]:
    # ... existing validation ...
    
    # Get all paths for this folder type
    folder_paths = self.folder_mappings.get(folder_type, [])
    
    if not folder_paths:
        raise ComfyUIError(f"Unknown folder type: {folder_type}")
    
    results = []
    files_searched = 0
    
    # Search in all paths
    for folder_path in folder_paths:
        if not folder_path.exists():
            continue
        
        # ... existing search logic ...
        # (iterate folder_path instead of single path)
    
    return results
```

---

## Type Changes

### Before
```python
self.folder_mappings: Dict[ComfyFolderType, str] = {
    ComfyFolderType.CHECKPOINTS: "models/checkpoints",
    # ...
}
```

### After
```python
self.folder_mappings: Dict[ComfyFolderType, List[Path]] = {
    ComfyFolderType.CHECKPOINTS: [
        Path("/path/to/comfyui/models/checkpoints"),
        Path("/path/to/a111/models/Stable-diffusion"),  # from extra_model_paths.yaml
    ],
    # ...
}
```

---

## Dependencies

**Add to `requirements.txt` (if not already present)**:
```txt
PyYAML>=6.0
```

---

## Error Handling Strategy

1. **Missing YAML file**: Graceful fallback to defaults (no error)
2. **Malformed YAML**: Log error, fallback to defaults
3. **Invalid paths in YAML**: Log warning, skip invalid paths
4. **Non-existent paths**: Log debug, skip during iteration
5. **Permission errors**: Log warning, skip inaccessible paths

**Principle**: Never fail initialization due to extra_model_paths issues. Always have working defaults.

---

## Testing Strategy

### Unit Tests

1. **ExtraModelPathsLoader**:
   - Test YAML parsing with valid configs
   - Test handling of missing base_path
   - Test handling of malformed YAML
   - Test platform-specific path detection

2. **PathResolver**:
   - Test pipe-separated path parsing
   - Test relative path resolution
   - Test absolute path handling
   - Test path validation
   - Test merging with defaults
   - Test deduplication

3. **ComfyUITools**:
   - Test list_folders with multiple paths
   - Test search_files with multiple paths
   - Test deduplication of same-named files
   - Test fallback when YAML missing

### Integration Tests

1. Create test YAML with known paths
2. Verify tools discover models from extra paths
3. Verify default paths still work
4. Verify duplicate files only listed once

---

## Migration Plan

### Phase 1: Create New Modules (No Breaking Changes)
- Create `extra_model_paths_loader.py`
- Create `path_resolver.py`
- Add unit tests
- **No changes to existing code yet**

### Phase 2: Update ComfyUITools (Internal Changes Only)
- Modify `__init__` to use new loaders
- Change `folder_mappings` type to `List[Path]`
- Update `list_folders()` to iterate multiple paths
- Update `search_files()` to iterate multiple paths
- **External API unchanged** (tools still work the same)

### Phase 3: Testing & Refinement
- Test with real extra_model_paths.yaml files
- Test edge cases (missing paths, malformed YAML)
- Performance testing (multiple large directories)
- Update documentation

### Phase 4: Optional Enhancements
- Add tool to list discovered paths
- Add tool to validate extra_model_paths.yaml
- Add caching for expensive path scans

---

## Code Duplication Prevention

### Before (Hypothetical Duplication Risk)
```python
# In list_folders:
for entry in folder_path.iterdir():
    # ... process entry ...

# In search_files:
for entry in folder_path.iterdir():
    # ... process entry ...
```

### After (Single Source of Truth)
```python
def _iter_all_paths(self, folder_type: ComfyFolderType) -> Iterator[Path]:
    """Iterate all paths for a folder type (internal helper)."""
    folder_paths = self.folder_mappings.get(folder_type, [])
    for folder_path in folder_paths:
        if folder_path.exists():
            yield folder_path

# Now both methods use:
for folder_path in self._iter_all_paths(folder_type):
    for entry in folder_path.iterdir():
        # ...
```

---

## Performance Considerations

1. **Multiple Path Iteration**: Minimal overhead (just iterating a list)
2. **Deduplication**: Using `set()` for O(1) lookups
3. **Path Validation**: Only done once during initialization
4. **YAML Parsing**: Only done once during initialization
5. **Caching**: Not needed initially (paths are already cached in memory)

---

## Documentation Updates Needed

1. **Tool Descriptions** (in `mcp_server.py`):
   - Update `comfy_list_folders` description to mention extra_model_paths support
   - Update `comfy_search_resources` description similarly

2. **README** (if exists):
   - Document extra_model_paths.yaml support
   - Show example configurations
   - Explain path priority (extra paths first)

3. **Code Comments**:
   - Document why we use List[Path] instead of single path
   - Document deduplication strategy

---

## Summary

### New Files
1. `backend/extra_model_paths_loader.py` - YAML parsing
2. `backend/path_resolver.py` - Path resolution and merging

### Modified Files
1. `backend/comfy_tools.py` - Use new loaders, handle multiple paths
2. `backend/requirements.txt` - Add PyYAML dependency

### No Changes Needed
1. `backend/comfy_models.py` - Models stay the same
2. `backend/mcp_server.py` - Tool signatures unchanged (only description updates)

### Key Design Decisions

1. **Modular**: Separate loader, resolver, and tools concerns
2. **Type Change**: `folder_mappings` becomes `Dict[Type, List[Path]]`
3. **Graceful Fallback**: Always have working defaults
4. **Deduplication**: Skip same-named files from multiple paths
5. **No Breaking Changes**: External API preserved

---

**Ready for implementation?** This design provides a clear, modular path forward with minimal risk and maximum maintainability.
