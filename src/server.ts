import express, { Application, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

import { prisma } from './config/database.js';
import { setupSocketHandlers } from './services/socketService.js';
import { initScheduler } from './services/schedulerService.js';
import { initIntegrationScheduler } from './services/integrationScheduler.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import broadcastRoutes from './routes/broadcastRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import planRoutes from './routes/planRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import quickReplyRoutes from './routes/quickReplyRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import chatbotRoutes from './routes/chatbotRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';

// Load environment variables
dotenv.config();

console.log('🚀 Backend starting...');
console.log('🔗 Public Backend URL:', process.env.BACKEND_URL || 'Not set (using localhost)');

const app: Application = express();
const httpServer = createServer(app);

// CORS origins
const allowedOrigins = process.env.FRONTEND_URL 
  ? [
      ...process.env.FRONTEND_URL.split(',').map(o => o.trim()),
      'http://localhost:5173',
      'http://localhost:3000'
    ]
  : ['*'];

console.log('🌍 Allowed Origins:', allowedOrigins);

// Socket.io setup
const io = new SocketServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io available globally
declare global {
  var io: SocketServer;
}
global.io = io;

// Middleware
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  credentials: true,
}));

import path from 'path';

// Raw body for webhook verification (supports dynamic orgId for Phase 2)
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom middleware to bypass ngrok browser warning for Meta bots
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Health check for Railway
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/broadcasts', broadcastRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/quick-replies', quickReplyRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/media', mediaRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Setup Socket.io handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📡 Socket.io is ready for connections`);
      console.log(`🔗 Webhook URL: http://localhost:${PORT}/api/webhook`);
      
      // Initialize background services
      initScheduler();
      initIntegrationScheduler();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();

export { app, io };
