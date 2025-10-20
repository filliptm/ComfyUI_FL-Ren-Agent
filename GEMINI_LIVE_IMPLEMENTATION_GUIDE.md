# Gemini Live API Implementation Guide

A comprehensive guide to implementing Google's Gemini Live API with custom tool calling capabilities.

## Table of Contents
1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Setup & Installation](#setup--installation)
4. [Implementing the Live Client](#implementing-the-live-client)
5. [Tool Calling System](#tool-calling-system)
6. [Audio Streaming](#audio-streaming)
7. [Best Practices](#best-practices)

---

## Overview

The Gemini Live API enables **real-time multimodal conversations** with Google's Gemini 2.0 models. Unlike traditional request/response APIs, it uses WebSockets for bidirectional streaming of:

- **Audio** (voice input/output)
- **Video** (screen capture, webcam)
- **Text** (chat messages)
- **Tool Calls** (function execution)

The agent can interrupt itself, process multiple modalities simultaneously, and execute custom functions you define.

---

## Core Architecture

### The Three-Layer Pattern

```
┌─────────────────────────────────────────┐
│   React Components (UI Layer)          │
│   - Handle tool registration            │
│   - Listen for tool call events         │
│   - Execute business logic              │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│   Context/Hooks Layer                   │
│   - Manage client lifecycle             │
│   - Provide app-wide access             │
│   - Handle connection state             │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│   GenAI Live Client (WebSocket Layer)   │
│   - Maintain WebSocket connection       │
│   - Emit events for messages            │
│   - Send/receive data                   │
└─────────────────────────────────────────┘
```

---

## Setup & Installation

### Dependencies

```bash
npm install @google/genai eventemitter3
```

### Environment Variables

```bash
# .env
REACT_APP_GEMINI_API_KEY=your_api_key_here
```

---

## Implementing the Live Client

### Step 1: Create the Event-Emitting Client

The client wraps the Google GenAI SDK and exposes an event-driven interface.

```typescript
// lib/genai-live-client.ts
import {
  GoogleGenAI,
  LiveConnectConfig,
  LiveServerMessage,
  LiveServerToolCall,
  Session,
} from "@google/genai";
import { EventEmitter } from "eventemitter3";

export interface LiveClientEventTypes {
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  content: (data: any) => void;
  error: (error: ErrorEvent) => void;
  interrupted: () => void;
  open: () => void;
  toolcall: (toolCall: LiveServerToolCall) => void;
  toolcallcancellation: (cancellation: any) => void;
  turncomplete: () => void;
}

export class GenAILiveClient extends EventEmitter<LiveClientEventTypes> {
  private client: GoogleGenAI;
  private _session: Session | null = null;
  private _status: "connected" | "disconnected" | "connecting" = "disconnected";
  private config: LiveConnectConfig | null = null;

  constructor(options: { apiKey: string }) {
    super();
    this.client = new GoogleGenAI(options);
  }

  async connect(model: string, config: LiveConnectConfig): Promise<boolean> {
    if (this._status === "connected" || this._status === "connecting") {
      return false;
    }

    this._status = "connecting";
    this.config = config;

    try {
      this._session = await this.client.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => this.emit("open"),
          onmessage: (msg) => this.handleMessage(msg),
          onerror: (e) => this.emit("error", e),
          onclose: (e) => this.emit("close", e),
        },
      });
      this._status = "connected";
      return true;
    } catch (e) {
      console.error("Connection failed:", e);
      this._status = "disconnected";
      return false;
    }
  }

  disconnect() {
    if (!this._session) return false;
    this._session.close();
    this._session = null;
    this._status = "disconnected";
    return true;
  }

  private handleMessage(message: LiveServerMessage) {
    // Setup complete
    if (message.setupComplete) {
      this.emit("setupcomplete");
      return;
    }

    // Tool call received
    if (message.toolCall) {
      this.emit("toolcall", message.toolCall);
      return;
    }

    // Tool call cancellation
    if (message.toolCallCancellation) {
      this.emit("toolcallcancellation", message.toolCallCancellation);
      return;
    }

    // Server content (text, audio, etc.)
    if (message.serverContent) {
      const { serverContent } = message;

      // Handle interruptions
      if ("interrupted" in serverContent) {
        this.emit("interrupted");
        return;
      }

      // Turn complete
      if ("turnComplete" in serverContent) {
        this.emit("turncomplete");
      }

      // Model turn with content
      if ("modelTurn" in serverContent) {
        const parts = serverContent.modelTurn?.parts || [];

        // Extract audio parts
        const audioParts = parts.filter(
          (p) => p.inlineData?.mimeType?.startsWith("audio/pcm")
        );

        // Emit audio events
        audioParts.forEach((p) => {
          if (p.inlineData?.data) {
            const arrayBuffer = base64ToArrayBuffer(p.inlineData.data);
            this.emit("audio", arrayBuffer);
          }
        });

        // Emit content for non-audio parts
        const otherParts = parts.filter((p) => !audioParts.includes(p));
        if (otherParts.length) {
          this.emit("content", { modelTurn: { parts: otherParts } });
        }
      }
    }
  }

  // Send real-time input (audio/video chunks)
  sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>) {
    chunks.forEach((chunk) => {
      this._session?.sendRealtimeInput({ media: chunk });
    });
  }

  // Send tool response
  sendToolResponse(toolResponse: { functionResponses: any[] }) {
    if (toolResponse.functionResponses?.length) {
      this._session?.sendToolResponse(toolResponse);
    }
  }

  // Send text/content
  send(parts: any | any[], turnComplete: boolean = true) {
    this._session?.sendClientContent({
      turns: Array.isArray(parts) ? parts : [parts],
      turnComplete,
    });
  }
}

// Utility function
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
```

### Step 2: Create a React Hook

Wrap the client in a hook for easy lifecycle management.

```typescript
// hooks/use-live-api.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { GenAILiveClient } from "../lib/genai-live-client";
import { LiveConnectConfig } from "@google/genai";

export function useLiveAPI(options: { apiKey: string }) {
  const client = useMemo(() => new GenAILiveClient(options), [options]);

  const [model, setModel] = useState("models/gemini-2.0-flash-exp");
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [connected, setConnected] = useState(false);

  // Listen to connection events
  useEffect(() => {
    const onOpen = () => setConnected(true);
    const onClose = () => setConnected(false);
    const onError = (error: ErrorEvent) => console.error("Error:", error);

    client
      .on("open", onOpen)
      .on("close", onClose)
      .on("error", onError);

    return () => {
      client
        .off("open", onOpen)
        .off("close", onClose)
        .off("error", onError)
        .disconnect();
    };
  }, [client]);

  const connect = useCallback(async () => {
    client.disconnect();
    await client.connect(model, config);
  }, [client, config, model]);

  const disconnect = useCallback(async () => {
    client.disconnect();
  }, [client]);

  return {
    client,
    config,
    setConfig,
    model,
    setModel,
    connected,
    connect,
    disconnect,
  };
}
```

### Step 3: Create a React Context

Provide the client to your entire app.

```typescript
// contexts/LiveAPIContext.tsx
import { createContext, FC, ReactNode, useContext } from "react";
import { useLiveAPI } from "../hooks/use-live-api";

const LiveAPIContext = createContext<ReturnType<typeof useLiveAPI> | undefined>(
  undefined
);

export const LiveAPIProvider: FC<{
  children: ReactNode;
  options: { apiKey: string };
}> = ({ options, children }) => {
  const liveAPI = useLiveAPI(options);

  return (
    <LiveAPIContext.Provider value={liveAPI}>
      {children}
    </LiveAPIContext.Provider>
  );
};

export const useLiveAPIContext = () => {
  const context = useContext(LiveAPIContext);
  if (!context) {
    throw new Error("useLiveAPIContext must be used within LiveAPIProvider");
  }
  return context;
};
```

### Step 4: Wrap Your App

```typescript
// App.tsx
import { LiveAPIProvider } from "./contexts/LiveAPIContext";

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY!;

function App() {
  return (
    <LiveAPIProvider options={{ apiKey: API_KEY }}>
      {/* Your app components */}
    </LiveAPIProvider>
  );
}
```

---

## Tool Calling System

### The Tool Lifecycle

```
1. REGISTER    →  Component adds tool to config
2. CONNECT     →  Client sends config to Gemini
3. CONVERSATION→  User interacts with agent
4. TOOL CALL   →  Gemini decides to call your tool
5. EXECUTE     →  Your code runs the function
6. RESPOND     →  Send results back to Gemini
7. CONTINUE    →  Gemini uses results in conversation
```

### Anatomy of a Tool

Every tool needs three things:

1. **Function Declaration** (schema)
2. **Registration Logic** (add to config)
3. **Execution Handler** (listen for calls)

### Example 1: Weather Tool

```typescript
// components/weather-tool/WeatherTool.tsx
import { useEffect } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import {
  FunctionDeclaration,
  LiveServerToolCall,
  Type,
} from "@google/genai";

// 1. DEFINE THE FUNCTION DECLARATION
const weatherToolDeclaration: FunctionDeclaration = {
  name: "get_weather",
  description: "Retrieves current weather for a given location",
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description: "City name or coordinates (e.g., 'San Francisco' or '37.77,-122.41')",
      },
      units: {
        type: Type.STRING,
        description: "Temperature units: 'celsius' or 'fahrenheit'",
        enum: ["celsius", "fahrenheit"],
      },
    },
    required: ["location"],
  },
};

export function WeatherTool() {
  const { client, setConfig, config } = useLiveAPIContext();

  // 2. REGISTER THE TOOL
  useEffect(() => {
    // Check if already registered (prevents duplicates)
    const toolExists = config?.tools?.some((tool) =>
      tool.functionDeclarations?.some((fd) => fd.name === "get_weather")
    );

    if (toolExists) return;

    // Get existing tools (filter out our tool if it somehow exists)
    const existingTools = (config?.tools || []).filter(
      (tool) =>
        !tool.functionDeclarations?.some((fd) => fd.name === "get_weather")
    );

    // Add our tool
    const newConfig = {
      ...config,
      tools: [
        ...existingTools,
        { functionDeclarations: [weatherToolDeclaration] },
      ],
      // Optionally add system instructions
      systemInstruction: {
        parts: [
          ...(config?.systemInstruction?.parts || []),
          {
            text: "When users ask about weather, use the get_weather function.",
          },
        ],
      },
    };

    setConfig(newConfig);
  }, [config, setConfig]);

  // 3. HANDLE TOOL CALLS
  useEffect(() => {
    const handleToolCall = async (toolCall: LiveServerToolCall) => {
      // Find our specific function call
      const weatherCall = toolCall.functionCalls?.find(
        (fc) => fc.name === "get_weather"
      );

      if (!weatherCall) return;

      // Extract arguments
      const { location, units = "celsius" } = weatherCall.args as {
        location: string;
        units?: string;
      };

      console.log(`Getting weather for ${location} in ${units}`);

      try {
        // Execute your actual logic
        const weatherData = await fetchWeatherFromAPI(location, units);

        // Send response back to Gemini
        client.sendToolResponse({
          functionResponses: [
            {
              id: weatherCall.id,
              name: weatherCall.name,
              response: {
                output: {
                  success: true,
                  temperature: weatherData.temp,
                  condition: weatherData.condition,
                  humidity: weatherData.humidity,
                },
              },
            },
          ],
        });
      } catch (error) {
        // Send error response
        client.sendToolResponse({
          functionResponses: [
            {
              id: weatherCall.id,
              name: weatherCall.name,
              response: {
                output: {
                  success: false,
                  error: error.message,
                },
              },
            },
          ],
        });
      }
    };

    // Subscribe to tool call events
    client.on("toolcall", handleToolCall);

    // Cleanup
    return () => {
      client.off("toolcall", handleToolCall);
    };
  }, [client]);

  // This component doesn't render UI, it just registers the tool
  return null;
}

// Mock API function (replace with your actual API)
async function fetchWeatherFromAPI(
  location: string,
  units: string
): Promise<{ temp: number; condition: string; humidity: number }> {
  // Simulate API call
  return {
    temp: units === "celsius" ? 22 : 72,
    condition: "Sunny",
    humidity: 65,
  };
}
```

### Example 2: Image Editing Tool

A more complex example with file handling:

```typescript
// components/image-editor/ImageEditor.tsx
import { useEffect } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { FunctionDeclaration, Type } from "@google/genai";
import * as fal from "@fal-ai/client";

const imageEditDeclaration: FunctionDeclaration = {
  name: "edit_image",
  description: "Edits an image based on a text prompt using AI",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "Editing instructions (e.g., 'make the sky purple')",
      },
      image_url: {
        type: Type.STRING,
        description: "URL of the image to edit",
      },
      strength: {
        type: Type.NUMBER,
        description: "Edit strength from 0.0 to 1.0 (default: 0.7)",
      },
    },
    required: ["prompt", "image_url"],
  },
};

export function ImageEditor() {
  const { client, setConfig, config } = useLiveAPIContext();

  // Registration
  useEffect(() => {
    const exists = config?.tools?.some((t) =>
      t.functionDeclarations?.some((fd) => fd.name === "edit_image")
    );
    if (exists) return;

    setConfig({
      ...config,
      tools: [
        ...(config?.tools || []),
        { functionDeclarations: [imageEditDeclaration] },
      ],
      systemInstruction: {
        parts: [
          ...(config?.systemInstruction?.parts || []),
          {
            text: "You can edit images using the edit_image function. Use it when users request image modifications.",
          },
        ],
      },
    });
  }, [config, setConfig]);

  // Execution
  useEffect(() => {
    const handleToolCall = async (toolCall: any) => {
      const editCall = toolCall.functionCalls?.find(
        (fc: any) => fc.name === "edit_image"
      );
      if (!editCall) return;

      const { prompt, image_url, strength = 0.7 } = editCall.args;

      try {
        // Call image editing API
        const result = await fal.subscribe("fal-ai/flux-pro", {
          input: {
            prompt,
            image_url,
            strength,
          },
        });

        // Send success response
        client.sendToolResponse({
          functionResponses: [
            {
              id: editCall.id,
              name: editCall.name,
              response: {
                output: {
                  success: true,
                  new_image_url: result.images[0].url,
                  message: "Image edited successfully",
                },
              },
            },
          ],
        });
      } catch (error) {
        client.sendToolResponse({
          functionResponses: [
            {
              id: editCall.id,
              name: editCall.name,
              response: {
                output: {
                  success: false,
                  error: error.message,
                },
              },
            },
          ],
        });
      }
    };

    client.on("toolcall", handleToolCall);
    return () => client.off("toolcall", handleToolCall);
  }, [client]);

  return null;
}
```

### Example 3: Database Query Tool

```typescript
const databaseQueryDeclaration: FunctionDeclaration = {
  name: "query_database",
  description: "Executes a read-only SQL query on the user database",
  parameters: {
    type: Type.OBJECT,
    properties: {
      table: {
        type: Type.STRING,
        description: "Table name to query",
        enum: ["users", "orders", "products"],
      },
      filters: {
        type: Type.OBJECT,
        description: "Key-value pairs for WHERE clause",
      },
      limit: {
        type: Type.NUMBER,
        description: "Max number of results (default: 10)",
      },
    },
    required: ["table"],
  },
};

// Handler
const handleToolCall = async (toolCall: any) => {
  const dbCall = toolCall.functionCalls?.find(
    (fc: any) => fc.name === "query_database"
  );
  if (!dbCall) return;

  const { table, filters = {}, limit = 10 } = dbCall.args;

  try {
    // Build and execute query (use parameterized queries!)
    const results = await executeQuery(table, filters, limit);

    client.sendToolResponse({
      functionResponses: [
        {
          id: dbCall.id,
          name: dbCall.name,
          response: {
            output: {
              success: true,
              results,
              count: results.length,
            },
          },
        },
      ],
    });
  } catch (error) {
    client.sendToolResponse({
      functionResponses: [
        {
          id: dbCall.id,
          name: dbCall.name,
          response: {
            output: { success: false, error: error.message },
          },
        },
      ],
    });
  }
};
```

### Tool Registration Best Practices

#### ✅ DO: Check for existing tools

```typescript
const toolExists = config?.tools?.some((tool) =>
  tool.functionDeclarations?.some((fd) => fd.name === "my_tool")
);
if (toolExists) return; // Don't re-register
```

#### ✅ DO: Preserve existing config

```typescript
const newConfig = {
  ...config, // Spread existing config
  tools: [...(config?.tools || []), myNewTool],
};
```

#### ✅ DO: Add descriptive system instructions

```typescript
systemInstruction: {
  parts: [
    ...(config?.systemInstruction?.parts || []),
    { text: "Use the weather tool when users ask about temperature or conditions." }
  ]
}
```

#### ❌ DON'T: Overwrite the entire config

```typescript
// BAD - This destroys other tools!
setConfig({
  tools: [{ functionDeclarations: [myTool] }],
});
```

#### ❌ DON'T: Register in a render loop

```typescript
// BAD - Infinite re-renders!
function MyComponent() {
  const { setConfig } = useLiveAPIContext();
  setConfig({ tools: [...] }); // ⚠️ Missing useEffect!
  return null;
}
```

---

## Audio Streaming

### Sending Audio to Gemini

```typescript
// Audio input example
import { useEffect, useRef } from "react";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";

export function AudioInput() {
  const { client } = useLiveAPIContext();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm",
    });

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        // Convert to base64
        const arrayBuffer = await event.data.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);

        // Send to Gemini
        client.sendRealtimeInput([
          {
            mimeType: "audio/pcm",
            data: base64,
          },
        ]);
      }
    };

    mediaRecorder.start(100); // Send chunks every 100ms
    mediaRecorderRef.current = mediaRecorder;
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  return (
    <div>
      <button onClick={startRecording}>Start Recording</button>
      <button onClick={stopRecording}>Stop Recording</button>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

### Receiving Audio from Gemini

```typescript
// Audio output example
import { useEffect, useRef } from "react";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";

export function AudioOutput() {
  const { client } = useLiveAPIContext();
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);

  useEffect(() => {
    // Initialize Web Audio API
    audioContextRef.current = new AudioContext({ sampleRate: 24000 });

    const handleAudio = async (data: ArrayBuffer) => {
      const audioContext = audioContextRef.current!;

      // Decode PCM16 audio
      const audioBuffer = audioContext.createBuffer(
        1, // mono
        data.byteLength / 2, // 16-bit = 2 bytes per sample
        24000 // sample rate
      );

      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(data);

      for (let i = 0; i < channelData.length; i++) {
        // Convert int16 to float32
        channelData[i] = view.getInt16(i * 2, true) / 32768.0;
      }

      // Play the audio
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
    };

    client.on("audio", handleAudio);
    return () => {
      client.off("audio", handleAudio);
    };
  }, [client]);

  return null;
}
```

---

## Best Practices

### 1. Error Handling

Always send error responses back to Gemini:

```typescript
try {
  const result = await myAsyncOperation();
  client.sendToolResponse({
    functionResponses: [{
      id: toolCall.id,
      name: toolCall.name,
      response: { output: { success: true, data: result } }
    }]
  });
} catch (error) {
  client.sendToolResponse({
    functionResponses: [{
      id: toolCall.id,
      name: toolCall.name,
      response: {
        output: {
          success: false,
          error: error.message,
          errorCode: error.code
        }
      }
    }]
  });
}
```

### 2. Handling Multiple Function Calls

Gemini can call multiple tools at once:

```typescript
const handleToolCall = async (toolCall: LiveServerToolCall) => {
  const responses = await Promise.all(
    toolCall.functionCalls.map(async (fc) => {
      if (fc.name === "tool1") {
        const result = await executeTool1(fc.args);
        return { id: fc.id, name: fc.name, response: { output: result } };
      }
      if (fc.name === "tool2") {
        const result = await executeTool2(fc.args);
        return { id: fc.id, name: fc.name, response: { output: result } };
      }
    })
  );

  client.sendToolResponse({ functionResponses: responses });
};
```

### 3. Config Management

Create a central config builder to avoid conflicts:

```typescript
// utils/config-builder.ts
import { LiveConnectConfig, FunctionDeclaration, Part } from "@google/genai";

export class ConfigBuilder {
  private config: LiveConnectConfig;

  constructor(baseConfig: LiveConnectConfig = {}) {
    this.config = { ...baseConfig };
  }

  addTool(declaration: FunctionDeclaration) {
    const exists = this.config.tools?.some((t) =>
      t.functionDeclarations?.some((fd) => fd.name === declaration.name)
    );
    if (exists) return this;

    this.config.tools = [
      ...(this.config.tools || []),
      { functionDeclarations: [declaration] },
    ];
    return this;
  }

  addInstruction(text: string) {
    const parts = this.config.systemInstruction?.parts || [];
    const exists = parts.some((p: Part) => p.text?.includes(text));
    if (exists) return this;

    this.config.systemInstruction = {
      parts: [...parts, { text }],
    };
    return this;
  }

  build(): LiveConnectConfig {
    return this.config;
  }
}

// Usage
const config = new ConfigBuilder(existingConfig)
  .addTool(weatherTool)
  .addTool(imageTool)
  .addInstruction("You are a helpful assistant.")
  .build();
```

### 4. Debugging Tools

Log all tool calls for debugging:

```typescript
useEffect(() => {
  const handleToolCall = (toolCall: LiveServerToolCall) => {
    console.log("🔧 Tool called:", {
      functions: toolCall.functionCalls.map((fc) => ({
        name: fc.name,
        args: fc.args,
        id: fc.id,
      })),
    });
    // ... execute tool
  };

  client.on("toolcall", handleToolCall);
  return () => client.off("toolcall", handleToolCall);
}, [client]);
```

### 5. Timeout Handling

Prevent hanging tool calls:

```typescript
const handleToolCall = async (toolCall: LiveServerToolCall) => {
  const fc = toolCall.functionCalls[0];

  try {
    // Race between execution and timeout
    const result = await Promise.race([
      executeMyTool(fc.args),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 30000)
      ),
    ]);

    client.sendToolResponse({
      functionResponses: [{
        id: fc.id,
        name: fc.name,
        response: { output: result }
      }]
    });
  } catch (error) {
    client.sendToolResponse({
      functionResponses: [{
        id: fc.id,
        name: fc.name,
        response: { output: { error: error.message } }
      }]
    });
  }
};
```

### 6. System Instruction Tips

Be specific about when to use tools:

```typescript
// ❌ Vague
"Use the weather tool."

// ✅ Specific
"When users ask about current weather, temperature, or conditions, use get_weather. For forecasts, explain you can only provide current data."

// ✅ With examples
"Use edit_image when users say things like 'make the sky purple', 'remove the background', or 'change the color to blue'."
```

### 7. Response Formatting

Structure tool responses for better model understanding:

```typescript
// ❌ Minimal
response: { output: { temp: 72 } }

// ✅ Rich context
response: {
  output: {
    success: true,
    temperature: 72,
    units: "fahrenheit",
    location: "San Francisco, CA",
    timestamp: new Date().toISOString(),
    condition: "Partly cloudy",
    // Add context for better conversation flow
    summary: "It's currently 72°F and partly cloudy in San Francisco."
  }
}
```

---

## Common Patterns

### Pattern 1: Progressive Tool Loading

Load tools only when needed:

```typescript
function App() {
  const [enableWeather, setEnableWeather] = useState(false);
  const [enableImages, setEnableImages] = useState(false);

  return (
    <LiveAPIProvider options={{ apiKey: API_KEY }}>
      {enableWeather && <WeatherTool />}
      {enableImages && <ImageEditor />}

      <button onClick={() => setEnableWeather(true)}>
        Enable Weather
      </button>
      <button onClick={() => setEnableImages(true)}>
        Enable Images
      </button>
    </LiveAPIProvider>
  );
}
```

### Pattern 2: Tool Response Streaming

For long-running operations, send progress updates:

```typescript
const handleToolCall = async (toolCall: any) => {
  const fc = toolCall.functionCalls[0];

  try {
    // Start the operation
    const operation = startLongOperation(fc.args);

    // Stream progress (not officially supported, but you can send text updates)
    operation.on("progress", (percent) => {
      client.send({
        text: `Processing... ${percent}% complete`
      }, false); // turnComplete = false keeps the turn open
    });

    const result = await operation.finish();

    // Send final tool response
    client.sendToolResponse({
      functionResponses: [{
        id: fc.id,
        name: fc.name,
        response: { output: result }
      }]
    });
  } catch (error) {
    // Handle error
  }
};
```

### Pattern 3: Conditional Tools

Enable tools based on user permissions:

```typescript
function ConditionalTools({ user }: { user: User }) {
  const { setConfig, config } = useLiveAPIContext();

  useEffect(() => {
    const tools = [];

    if (user.permissions.includes("weather")) {
      tools.push({ functionDeclarations: [weatherTool] });
    }

    if (user.permissions.includes("database")) {
      tools.push({ functionDeclarations: [databaseTool] });
    }

    if (user.role === "admin") {
      tools.push({ functionDeclarations: [adminTool] });
    }

    setConfig({ ...config, tools });
  }, [user, config, setConfig]);

  return null;
}
```

---

## Testing Tools

### Unit Testing Tool Handlers

```typescript
// __tests__/weather-tool.test.ts
import { GenAILiveClient } from "../lib/genai-live-client";

describe("WeatherTool", () => {
  it("should handle weather requests", async () => {
    const mockClient = new GenAILiveClient({ apiKey: "test" });
    const mockSendToolResponse = jest.fn();
    mockClient.sendToolResponse = mockSendToolResponse;

    const toolCall = {
      functionCalls: [
        {
          id: "123",
          name: "get_weather",
          args: { location: "San Francisco", units: "celsius" },
        },
      ],
    };

    // Trigger handler
    await handleWeatherToolCall(toolCall, mockClient);

    // Verify response
    expect(mockSendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        expect.objectContaining({
          id: "123",
          name: "get_weather",
          response: {
            output: expect.objectContaining({
              success: true,
              temperature: expect.any(Number),
            }),
          },
        }),
      ],
    });
  });
});
```

---

## Full Example: Complete Component

Here's a complete, production-ready tool component:

```typescript
// components/calculator/Calculator.tsx
import { useEffect, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import {
  FunctionDeclaration,
  LiveServerToolCall,
  Type,
} from "@google/genai";

const calculatorDeclaration: FunctionDeclaration = {
  name: "calculate",
  description: "Performs mathematical calculations",
  parameters: {
    type: Type.OBJECT,
    properties: {
      expression: {
        type: Type.STRING,
        description: "Mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)')",
      },
    },
    required: ["expression"],
  },
};

export function Calculator() {
  const { client, setConfig, config } = useLiveAPIContext();
  const [history, setHistory] = useState<Array<{ expression: string; result: number }>>([]);

  // Register tool
  useEffect(() => {
    const exists = config?.tools?.some((tool) =>
      tool.functionDeclarations?.some((fd) => fd.name === "calculate")
    );
    if (exists) return;

    const newConfig = {
      ...config,
      tools: [
        ...(config?.tools || []),
        { functionDeclarations: [calculatorDeclaration] },
      ],
      systemInstruction: {
        parts: [
          ...(config?.systemInstruction?.parts || []),
          {
            text: "Use the calculate function for any mathematical operations. Examples: 'what is 15% of 200?', 'square root of 144', '5 + 3 * 2'.",
          },
        ],
      },
    };

    setConfig(newConfig);
  }, [config, setConfig]);

  // Handle tool calls
  useEffect(() => {
    const handleToolCall = async (toolCall: LiveServerToolCall) => {
      const calcCall = toolCall.functionCalls?.find(
        (fc) => fc.name === "calculate"
      );
      if (!calcCall) return;

      const { expression } = calcCall.args as { expression: string };

      try {
        // Validate expression (prevent code injection)
        if (!/^[\d\s+\-*/().]+$/.test(expression)) {
          throw new Error("Invalid expression");
        }

        // Calculate (in production, use a proper math parser)
        const result = eval(expression);

        // Update history
        setHistory((prev) => [...prev, { expression, result }]);

        // Send response
        client.sendToolResponse({
          functionResponses: [
            {
              id: calcCall.id,
              name: calcCall.name,
              response: {
                output: {
                  success: true,
                  expression,
                  result,
                  formattedResult: `${expression} = ${result}`,
                },
              },
            },
          ],
        });
      } catch (error) {
        client.sendToolResponse({
          functionResponses: [
            {
              id: calcCall.id,
              name: calcCall.name,
              response: {
                output: {
                  success: false,
                  error: "Could not evaluate expression",
                },
              },
            },
          ],
        });
      }
    };

    client.on("toolcall", handleToolCall);
    return () => {
      client.off("toolcall", handleToolCall);
    };
  }, [client]);

  // Optional: Render calculation history
  return (
    <div className="calculator">
      <h3>Calculation History</h3>
      {history.map((item, i) => (
        <div key={i}>
          {item.expression} = {item.result}
        </div>
      ))}
    </div>
  );
}
```

---

## Troubleshooting

### Tool not being called

1. Check system instruction mentions the tool
2. Verify tool is in `config.tools` before connecting
3. Make parameter descriptions clear and specific
4. Check console for connection errors

### Multiple re-registrations

```typescript
// Add dependency array to useEffect
useEffect(() => {
  // registration logic
}, [config, setConfig]); // ✅ Prevents infinite loops
```

### Config conflicts

```typescript
// Always spread existing config
setConfig({
  ...config, // ✅ Preserve existing settings
  tools: [...(config?.tools || []), newTool],
});
```

### Audio not playing

- Check sample rate (Gemini uses 24000 Hz)
- Verify audio format is PCM16
- Ensure Web Audio API context is resumed (browser autoplay policy)

---

## Additional Resources

- **Official Docs**: https://ai.google.dev/gemini-api/docs/live
- **SDK Reference**: https://github.com/google/generative-ai-js
- **Tool Schema**: Follow JSON Schema spec for parameter definitions

---

This guide covers everything needed to build a production-ready Gemini Live application with custom tool calling. Start with the basic client setup, add tools incrementally, and follow the patterns outlined for robust, maintainable code.
