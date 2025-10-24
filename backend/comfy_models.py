"""Pydantic models for ComfyUI extended tools."""

from typing import List, Dict, Optional, Any, Union
from pydantic import BaseModel, Field
from enum import Enum


class ComfyFolderType(str, Enum):
    """Supported ComfyUI folder types."""
    CUSTOM_NODES = "custom_nodes"
    MODELS = "models"
    CHECKPOINTS = "checkpoints"
    LORAS = "loras"
    VAE = "vae"
    CONTROLNET = "controlnet"
    UPSCALE_MODELS = "upscale_models"
    EMBEDDINGS = "embeddings"
    OUTPUT = "output"
    INPUT = "input"
    TEMP = "temp"
    WORKFLOWS = "workflows"


class ComfyFileInfo(BaseModel):
    """Information about a ComfyUI file or directory."""
    name: str = Field(..., description="File or directory name")
    path: str = Field(..., description="Relative path from ComfyUI root")
    is_directory: bool = Field(..., description="True if this is a directory")
    size: Optional[int] = Field(None, description="File size in bytes")
    modified_time: Optional[float] = Field(None, description="Last modified timestamp")
    extension: Optional[str] = Field(None, description="File extension")


class ComfySearchResult(BaseModel):
    """Result from pattern search in ComfyUI files."""
    file_path: str = Field(..., description="Relative path to file containing match")
    line_number: int = Field(..., description="Line number of match")
    line_content: str = Field(..., description="Content of matching line")
    context_before: List[str] = Field(default_factory=list, description="Lines before match")
    context_after: List[str] = Field(default_factory=list, description="Lines after match")


# REQUEST MODELS
class ComfyListFoldersRequest(BaseModel):
    """Request to list ComfyUI directory contents."""
    folder_type: ComfyFolderType = Field(
        ..., 
        description="Type of ComfyUI directory to list"
    )


class ComfyReadFileRequest(BaseModel):
    """Request to read a file within ComfyUI directory."""
    path: str = Field(
        ..., 
        description="Relative path to file from ComfyUI root"
    )
    max_size: int = Field(
        1024 * 1024,  # 1MB
        description="Maximum file size to read in bytes"
    )


class ComfySearchFilesRequest(BaseModel):
    """Request to search for patterns in ComfyUI files."""
    pattern: str = Field(
        ..., 
        description="Regular expression pattern to search for"
    )
    folder_type: ComfyFolderType = Field(
        ComfyFolderType.CUSTOM_NODES,
        description="Directory to search in"
    )
    file_pattern: Optional[str] = Field(
        None,
        description="Optional glob pattern to filter files (e.g., '*.py')"
    )
    max_results: int = Field(
        20,
        description="Maximum number of search results to return"
    )
    context_lines: int = Field(
        2,
        description="Number of context lines around each match"
    )


# RESPONSE MODELS
class ComfyListFoldersResponse(BaseModel):
    """Response from listing ComfyUI directory contents."""
    folder_type: str = Field(..., description="Type of folder that was listed")
    folder_path: str = Field(..., description="Directory path that was listed")
    items: List[ComfyFileInfo] = Field(..., description="List of files and directories")
    total_items: int = Field(..., description="Total number of items found")
    comfyui_root: str = Field(..., description="ComfyUI installation root path")


class ComfyReadFileResponse(BaseModel):
    """Response from reading a ComfyUI file."""
    path: str = Field(..., description="Path to the file that was read")
    content: str = Field(..., description="File content as text")
    size: int = Field(..., description="File size in bytes")
    encoding: str = Field(..., description="Text encoding used")
    extension: str = Field(..., description="File extension")
    comfyui_root: str = Field(..., description="ComfyUI installation root path")


class ComfySearchFilesResponse(BaseModel):
    """Response from searching ComfyUI files."""
    pattern: str = Field(..., description="Search pattern that was used")
    folder_type: str = Field(..., description="Directory that was searched")
    results: List[ComfySearchResult] = Field(..., description="List of search matches")
    total_matches: int = Field(..., description="Total number of matches found")
    files_searched: int = Field(..., description="Number of files searched")
    truncated: bool = Field(..., description="True if results were truncated")
    comfyui_root: str = Field(..., description="ComfyUI installation root path")
