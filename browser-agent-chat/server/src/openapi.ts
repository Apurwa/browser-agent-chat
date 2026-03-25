import swaggerJsdoc from 'swagger-jsdoc';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'QA Agent API',
      version: '1.0.0',
      description: 'API for the QA Agent browser automation platform. Manage agents, run tasks, track findings, and monitor observability.',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase JWT access token',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Health', description: 'Server health' },
      { name: 'Agents', description: 'Agent CRUD and session management' },
      { name: 'Findings', description: 'Discovered bugs and issues' },
      { name: 'Memory', description: 'Learned features and flows' },
      { name: 'Suggestions', description: 'Agent suggestions for features/flows' },
      { name: 'Evals', description: 'Evaluation cases, runs, and scheduling' },
      { name: 'Feedback', description: 'Task feedback and learning patterns' },
      { name: 'App Map', description: 'Navigation graph data' },
      { name: 'Traces', description: 'Langfuse trace data' },
      { name: 'Observability', description: 'Cross-agent metrics and trends' },
      { name: 'Vault', description: 'Credential management and bindings' },
    ],
  },
  apis: ['./src/routes/*.ts', './src/index.ts'],
});

export default spec;
