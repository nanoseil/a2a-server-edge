# A2A Server for Edge Runtime

This project provides an A2A (Application to Application) server designed for edge runtime environments. It leverages the @a2a-js/sdk to facilitate communication between applications in a decentralized manner.

Currently only Cloudflare Workers is supported.

## Usage

Install the package via npm:

```bash
npm install @nanoseil/a2a-server-edge @a2a-js/sdk
```

Then, you can import and use the server in your edge runtime environment:

```typescript
import { createServer } from '@nanoseil/a2a-server-edge';
import { DefaultRequestHandler, InMemoryTaskStore, type AgentCard } from '@a2a-js/sdk';

const agentCard: AgentCard = { ... }
const taskStore = new InMemoryTaskStore();

const agentExecutor = new YourAgentExecutor();

const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor
);

const server = createServer(requestHandler);

export default server;
```
