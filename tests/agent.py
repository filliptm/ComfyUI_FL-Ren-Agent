#!/usr/bin/env python3
"""MCP Test Agent - CLI Agent for testing MCP server functionality.

This agent connects directly to the MCP server and provides a CLI interface
for testing all the ComfyUI workflow tools.
"""

from pydantic_ai import Agent, RunContext
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.messages import ModelMessage, SystemPromptPart, UserPromptPart, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.agent import AgentRunResult
import logfire

from dotenv import load_dotenv
import os
import argparse
import asyncio
import traceback
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

load_dotenv()

logfire.configure(token=os.getenv("LOGFIRE_API_KEY"))
logfire.instrument_openai()

# Parse command line arguments
def parse_args():
    parser = argparse.ArgumentParser(description="MCP Test Agent - CLI testing for MCP server")
    parser.add_argument(
        "--model", 
        type=str, 
        default="anthropic/claude-3.7-sonnet",
        help="Model identifier to use with OpenRouter (default: anthropic/claude-3.7-sonnet)"
    )
    parser.add_argument(
        "--test-suite",
        type=str,
        choices=["basic", "workflow", "layout", "system", "all"],
        help="Run a specific test suite instead of interactive mode"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output for debugging"
    )
    return parser.parse_args()

# Get command line arguments
args = parse_args()

# Set up OpenRouter based model
API_KEY = os.getenv('OPENROUTER_API_KEY')
if not API_KEY:
    print("Error: OPENROUTER_API_KEY environment variable not set")
    exit(1)

model = OpenAIModel(
    args.model,  # Use the model from command line arguments
    provider=OpenAIProvider(
        base_url='https://openrouter.ai/api/v1', 
        api_key=API_KEY
    ),
)

# MCP Environment variables - add any needed for the MCP server
env = {
    # Add environment variables that the MCP server might need
    "PYTHONPATH": os.environ.get("PYTHONPATH", ""),
}

# Set up MCP Server for the Agent
mcp_servers = [
    MCPServerStdio('python', ['backend/mcp_server.py'], env=env),
]

# Function to filter message history
def filtered_message_history(
    result: Optional[AgentRunResult], 
    limit: Optional[int] = None, 
    include_tool_messages: bool = True
) -> Optional[List[Dict[str, Any]]]:
    """
    Filter and limit the message history from an AgentRunResult.
    
    Args:
        result: The AgentRunResult object with message history
        limit: Optional int, if provided returns only system message + last N messages
        include_tool_messages: Whether to include tool messages in the history
        
    Returns:
        Filtered list of messages in the format expected by the agent
    """
    if result is None:
        return None
        
    # Get all messages
    messages: list[ModelMessage] = result.all_messages()
    
    # Extract system message (always the first one with role="system")
    system_message = next((msg for msg in messages if type(msg.parts[0]) == SystemPromptPart), None)
    
    # Filter non-system messages
    non_system_messages = [msg for msg in messages if type(msg.parts[0]) != SystemPromptPart]
    
    # Apply tool message filtering if requested
    if not include_tool_messages:
        non_system_messages = [msg for msg in non_system_messages if not any(isinstance(part, ToolCallPart) or isinstance(part, ToolReturnPart) for part in msg.parts)]
    
    # Find the most recent UserPromptPart before applying limit
    latest_user_prompt_part = None
    latest_user_prompt_index = -1
    for i, msg in enumerate(non_system_messages):
        for part in msg.parts:
            if isinstance(part, UserPromptPart):
                latest_user_prompt_part = part
                latest_user_prompt_index = i
    
    # Apply limit if specified, but ensure paired tool calls and returns stay together
    if limit is not None and limit > 0:
        # Identify tool call IDs and their corresponding return parts
        tool_call_ids = {}
        tool_return_ids = set()
        
        for i, msg in enumerate(non_system_messages):
            for part in msg.parts:
                if isinstance(part, ToolCallPart):
                    tool_call_ids[part.tool_call_id] = i
                elif isinstance(part, ToolReturnPart):
                    tool_return_ids.add(part.tool_call_id)
        
        # Take the last 'limit' messages but ensure we include paired messages
        if len(non_system_messages) > limit:
            included_indices = set(range(len(non_system_messages) - limit, len(non_system_messages)))
            
            # Include any missing tool call messages for tool returns that are included
            for i, msg in enumerate(non_system_messages):
                if i in included_indices:
                    for part in msg.parts:
                        if isinstance(part, ToolReturnPart) and part.tool_call_id in tool_call_ids:
                            included_indices.add(tool_call_ids[part.tool_call_id])
            
            # Check if the latest UserPromptPart would be excluded by the limit
            if (latest_user_prompt_index >= 0 and 
                latest_user_prompt_index not in included_indices and 
                latest_user_prompt_part is not None and 
                system_message is not None):
                # Find if system_message already has a UserPromptPart
                user_prompt_index = next((i for i, part in enumerate(system_message.parts) 
                                       if isinstance(part, UserPromptPart)), None)
                
                if user_prompt_index is not None:
                    # Replace existing UserPromptPart
                    system_message.parts[user_prompt_index] = latest_user_prompt_part
                else:
                    # Add new UserPromptPart to system message
                    system_message.parts.append(latest_user_prompt_part)
            
            # Create a new list with only the included messages
            non_system_messages = [msg for i, msg in enumerate(non_system_messages) if i in included_indices]
    
    # Combine system message with other messages
    result_messages = []
    if system_message:
        result_messages.append(system_message)
    result_messages.extend(non_system_messages)
    
    return result_messages

# Set up Agent with Server
agent_name = "mcptest"
def load_agent_prompt(agent: str):
    """Loads given agent replacing `time_now` var with current time"""
    print(f"Loading {agent} agent...")
    time_now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    
    # Get the current directory and construct the path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    agent_path = os.path.join(project_root, "agents", f"{agent}.md")
    
    try:
        with open(agent_path, "r") as f:
            agent_prompt = f.read()
        agent_prompt = agent_prompt.replace('{time_now}', time_now)
        return agent_prompt
    except FileNotFoundError:
        print(f"Warning: Agent prompt file not found at {agent_path}")
        print("Using fallback system prompt...")
        return f"""You are an MCP Test Agent.
        
Current Time: {time_now}
        
You are designed to test MCP server functionality. You have access to ComfyUI workflow tools through the MCP protocol.
        
When testing:
        1. Start with simple operations
        2. Verify results after each operation
        3. Report any issues clearly
        4. Build complexity gradually
        """

# Load up the agent system prompt
agent_prompt = load_agent_prompt(agent_name)

# Display the selected model
print(f"Using model: {args.model}")
print(f"Verbose mode: {args.verbose}")
if args.test_suite:
    print(f"Running test suite: {args.test_suite}")

agent = Agent(model, mcp_servers=mcp_servers, system_prompt=agent_prompt)

# Test suites
TEST_SUITES = {
    "basic": [
        "Hello! Let's start testing. First, please run a workflow_overview to see what we're working with.",
        "Now try to find any KSampler nodes in the workflow using the find_node tool.",
        "Generate a random seed using the generate_seed tool.",
        "Get the current queue status using get_queue_status."
    ],
    "workflow": [
        "Let's test workflow creation. First, get a workflow overview.",
        "Create a new CheckpointLoaderSimple node at position x=100, y=100.",
        "Create a KSampler node at position x=400, y=100.",
        "Try to connect the CheckpointLoader MODEL output to the KSampler model input.",
        "Generate a workflow diagram to visualize what we've created."
    ],
    "layout": [
        "Let's test layout tools. First, get workflow overview.",
        "Find the first node in the workflow and get its rectangle/position.",
        "Create a new node and position it to the right of the first node.",
        "Create another node and position it below the first node.",
        "Generate a diagram to see the layout."
    ],
    "system": [
        "Let's test system control tools.",
        "Get the current queue status.",
        "Try setting the batch count to 3.",
        "Test generating random values: int between 1-10, float between 0.5-1.5.",
        "Test random choice from a list of samplers: ['euler', 'euler_a', 'dpmpp_2m']."
    ]
}

async def run_test_suite(suite_name: str) -> None:
    """Run a predefined test suite."""
    if suite_name == "all":
        for name, tests in TEST_SUITES.items():
            print(f"\n{'='*50}")
            print(f"RUNNING TEST SUITE: {name.upper()}")
            print(f"{'='*50}")
            await run_test_suite(name)
        return
    
    if suite_name not in TEST_SUITES:
        print(f"Unknown test suite: {suite_name}")
        return
    
    tests = TEST_SUITES[suite_name]
    result: AgentRunResult = None
    
    for i, test_prompt in enumerate(tests, 1):
        print(f"\n--- Test {i}/{len(tests)} ---")
        print(f"Prompt: {test_prompt}")
        print("-" * 50)
        
        for attempt in range(2):
            try:
                result = await agent.run(
                    test_prompt,
                    message_history=filtered_message_history(
                        result,
                        limit=10,
                        include_tool_messages=True
                    )
                )
                break
            except Exception as e:
                if attempt == 1:  # Last attempt
                    print(f"Error on test {i}: {e}")
                    if args.verbose:
                        traceback.print_exc()
                else:
                    print(f"Retry attempt {attempt + 1} after error: {e}")
                    await asyncio.sleep(2)
        
        if result and result.output:
            print(f"Response: {result.output}")
        else:
            print("No response received")
        
        print("\n" + "="*50)

async def interactive_mode() -> None:
    """Run interactive CLI mode."""
    print("\nMCP Test Agent - Interactive Mode")
    print("Type 'exit' or 'quit' to end the session")
    print("Type 'help' for available commands\n")
    
    result: AgentRunResult = None
    
    while True:
        try:
            user_input = input("\n> ").strip()
            
            if user_input.lower() in ['exit', 'quit', 'q']:
                print("Goodbye!")
                break
            
            if user_input.lower() == 'help':
                print("""
Available commands:
- exit/quit/q: Exit the agent
- help: Show this help message
- Any other input: Send to the agent for processing

Example test prompts:
- "Get a workflow overview"
- "Find all KSampler nodes"
- "Create a new CheckpointLoaderSimple node"
- "Generate a workflow diagram"
- "What tools do you have available?"
                """)
                continue
            
            if not user_input:
                continue
            
            err = None
            for attempt in range(2):
                try:
                    result = await agent.run(
                        user_input,
                        message_history=filtered_message_history(
                            result,
                            limit=24,
                            include_tool_messages=True
                        )
                    )
                    break
                except Exception as e:
                    err = e
                    if args.verbose:
                        traceback.print_exc()
                    if attempt == 0:
                        print(f"Retrying after error: {e}")
                        await asyncio.sleep(2)
            
            if result is None:
                print(f"\nError: {err}. Please try again.\n")
                continue
            elif len(result.output) == 0:
                print("Empty response received.")
                continue
            else:
                print(f"\n{result.output}")
                
        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Unexpected error: {e}")
            if args.verbose:
                traceback.print_exc()

async def main():
    """Main entry point."""
    print("Starting MCP Test Agent...")
    
    async with agent.run_mcp_servers():
        print("MCP server connection established.")
        
        if args.test_suite:
            await run_test_suite(args.test_suite)
        else:
            await interactive_mode()

if __name__ == "__main__":
    asyncio.run(main())
