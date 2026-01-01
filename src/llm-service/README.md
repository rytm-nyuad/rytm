# RYTM AI Agent System

**Modular, scalable agent architecture for RYTM wellness app**

This directory contains the core AI agent system that powers RYTM's intelligent features. The architecture is designed for easy extension, testability, and clear separation of concerns.

---

## 📁 Architecture Overview

```
llm-service/
├── agents/          # Agent implementations (Journal, Coach, Insights, etc.)
├── tools/           # Reusable tools agents can use (database, API calls)
├── types/           # TypeScript interfaces and types
├── graphs/          # LangGraph workflows for complex multi-agent orchestration
├── config/          # LLM models, prompts, and configuration
└── README.md        # This file
```

---

## 🏗️ Design Principles

### 1. **Separation of Concerns**
- **Agents**: Business logic and orchestration
- **Tools**: External integrations (database, APIs)
- **API Routes**: Thin wrappers that handle auth and HTTP

### 2. **Stateless Agents**
All state is stored in the database. Agents are pure functions that can be easily tested.

### 3. **Easy to Extract**
Code is written to be easily moved to a separate microservice if needed. No tight coupling to Next.js.

### 4. **Framework Agnostic**
Uses standard LangChain patterns that work anywhere.

---

## 🤖 Current Agents

### JournalAgent
**Purpose**: Handles guided journaling with empathetic AI responses

**Modes**:
- `free`: Save journal entry without AI response
- `guided`: Conversational journaling with AI companion

**Usage**:
```typescript
import { JournalAgent } from "@/llm-service/agents";

const agent = new JournalAgent();
const result = await agent.run(
  { userId, content, mode: "guided" },
  { supabase, userId }
);
```

**Features**:
- Conversation history management
- Thread-based conversations
- Configurable context window

---

## 🛠️ Tools System

Tools are reusable functions that agents can call to interact with external systems.

### Current Tools
- `JournalDatabaseTool`: Journal data operations
- `DashboardDatabaseTool`: Wellness data operations

### Adding New Tools
```typescript
export class NewTool {
  static async doSomething(params) {
    // Implementation
  }
}
```

---

## 🔧 Configuration

### LLM Models
See [config/llm.ts](./config/llm.ts)

Available presets:
- `conversational`: Fast, for chat (GPT-4o-mini)
- `analytical`: Smart, for insights (GPT-4o)
- `creative`: Balanced, for suggestions (Claude 3.5)

### System Prompts
See [config/prompts.ts](./config/prompts.ts)

All agent prompts are centralized for easy modification.

---

## 📊 LangGraph Integration

The `graphs/` directory is reserved for complex multi-agent workflows using LangGraph.

**Use cases**:
- Multi-step reasoning
- Agent collaboration
- Complex decision trees
- State machines

**Example (future)**:
```typescript
// graphs/wellness-coach-graph.ts
const graph = new StateGraph()
  .addNode("analyze", analyzeWellnessData)
  .addNode("suggest", suggestActions)
  .addNode("motivate", generateMotivation)
  .addEdge("analyze", "suggest")
  .addEdge("suggest", "motivate");
```

---

## 🚀 Adding New Agents

### Step 1: Create Agent File
```typescript
// agents/new-agent.ts
import { AgentInput, AgentOutput, AgentContext } from "../types";

export class NewAgent {
  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    // Your logic here
    return { success: true, data: result };
  }
}
```

### Step 2: Export from index
```typescript
// agents/index.ts
export * from "./new-agent";
```

### Step 3: Use in API Route
```typescript
// app/api/your-route/route.ts
import { NewAgent } from "@/llm-service/agents";

const agent = new NewAgent();
const result = await agent.run(input, context);
```

---

## 🧪 Testing Strategy

### Unit Tests (Future)
```typescript
// __tests__/agents/journal-agent.test.ts
import { JournalAgent } from "@/llm-service/agents";

describe("JournalAgent", () => {
  it("should handle free mode", async () => {
    const agent = new JournalAgent();
    const result = await agent.run(mockInput, mockContext);
    expect(result.success).toBe(true);
  });
});
```

### Integration Tests
Test agents with real Supabase instance (dev environment).

---

## 📈 Scaling Strategy

### Current: Module Separation (Single Server)
- ✅ Simple deployment
- ✅ Fast iteration
- ✅ Easy debugging

### Future: Microservice (If Needed)
- Extract `llm-service/` to separate Node.js server
- API routes make HTTP calls to agent service
- Independent scaling and deployment

**When to split**:
- 100K+ users
- Long-running agent tasks (>30s)
- Need specialized infrastructure

---

## 🎯 Capstone Contribution

This agent system is the **core technical contribution** for the capstone project.

**Key Innovations**:
1. Clean separation of AI logic from application code
2. Tool-based architecture for easy extension
3. Multi-agent orchestration patterns
4. Production-ready scalability path

**Future Additions**:
- [ ] Coach Agent (motivational feedback)
- [ ] Insight Agent (data analysis)
- [ ] Habit Agent (behavior tracking)
- [ ] Multi-agent collaboration graphs
- [ ] Function calling / tool use
- [ ] Streaming responses
- [ ] Agent memory systems

---

## 📝 Best Practices

### Do ✅
- Keep agents stateless
- Use tools for external operations
- Document all agent behaviors
- Test agent logic independently
- Use proper error handling

### Don't ❌
- Put HTTP logic in agents
- Directly import from `@/app`
- Hardcode API keys in agent code
- Create circular dependencies
- Mix presentation logic with agent logic

---

## 🔗 Resources

- [LangChain Docs](https://js.langchain.com/docs/)
- [LangGraph Guide](https://langchain-ai.github.io/langgraphjs/)
- [OpenRouter Models](https://openrouter.ai/docs)

---

## 🤝 Contributing

When adding new agents:
1. Follow the existing patterns
2. Add proper TypeScript types
3. Document in this README
4. Add tests (when test suite is set up)
5. Update relevant API routes

---

**Questions?** Check the codebase or ask the team.
