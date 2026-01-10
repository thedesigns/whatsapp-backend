import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { UserStatus } from '@prisma/client';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

// Track online users
const onlineUsers = new Map<string, string>(); // userId -> socketId

export const setupSocketHandlers = (io: SocketServer) => {
  // Authentication middleware for socket connections
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(
        token as string,
        process.env.JWT_SECRET || 'default_secret'
      ) as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          organizationId: true,
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.userId = user.id;
      socket.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      } as any;

      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const organizationId = (socket.user as any)?.organizationId;
    console.log(`🔌 User connected: ${socket.user?.name} (${userId}) - Org: ${organizationId}`);

    // Add user to online users
    onlineUsers.set(userId, socket.id);

    // Update user status to online
    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ONLINE, lastSeen: new Date() },
    });

    // Join organization specific room
    if (organizationId) {
      socket.join(`org:${organizationId}`);
    }

    // Broadcast user online status
    io.emit('user_status', { userId, status: 'ONLINE' });

    // Join user to their own room for direct messages
    socket.join(`user:${userId}`);

    // Handle joining conversation rooms
    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`User ${userId} joined conversation: ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`User ${userId} left conversation: ${conversationId}`);
    });

    // Handle typing indicator
    socket.on('typing_start', (conversationId: string) => {
      socket.to(`conversation:${conversationId}`).emit('typing', {
        conversationId,
        userId,
        userName: socket.user?.name,
        isTyping: true,
      });
    });

    socket.on('typing_stop', (conversationId: string) => {
      socket.to(`conversation:${conversationId}`).emit('typing', {
        conversationId,
        userId,
        userName: socket.user?.name,
        isTyping: false,
      });
    });

    // Handle manual status change
    socket.on('set_status', async (status: string) => {
      const validStatuses = ['ONLINE', 'OFFLINE', 'BUSY', 'AWAY'];
      if (validStatuses.includes(status)) {
        await prisma.user.update({
          where: { id: userId },
          data: { status: status as UserStatus },
        });
        io.emit('user_status', { userId, status });
      }
    });

    // Handle read receipts
    socket.on('mark_read', async (data: { conversationId: string; messageIds: string[] }) => {
      const { conversationId, messageIds } = data;
      
      await prisma.message.updateMany({
        where: {
          id: { in: messageIds },
          conversationId,
        },
        data: { isRead: true },
      });

      // Reset unread count
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      });

      socket.to(`conversation:${conversationId}`).emit('messages_read', {
        conversationId,
        messageIds,
        readBy: userId,
      });
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`🔌 User disconnected: ${socket.user?.name} (${userId})`);
      
      onlineUsers.delete(userId);

      // Update user status to offline
      await prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.OFFLINE, lastSeen: new Date() },
      });

      // Broadcast user offline status
      io.emit('user_status', { userId, status: 'OFFLINE' });
    });
  });

  console.log('📡 Socket.io handlers initialized');
};

// Utility functions for emitting events from other parts of the app
export const emitToConversation = (conversationId: string, event: string, data: any) => {
  global.io?.to(`conversation:${conversationId}`).emit(event, data);
};

export const emitToUser = (userId: string, event: string, data: any) => {
  global.io?.to(`user:${userId}`).emit(event, data);
};

export const emitToAll = (event: string, data: any) => {
  global.io?.emit(event, data);
};

export const getOnlineUsers = () => {
  return Array.from(onlineUsers.keys());
};

export const isUserOnline = (userId: string) => {
  return onlineUsers.has(userId);
};
