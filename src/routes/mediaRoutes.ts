import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { downloadMediaContent } from '../services/whatsappService.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request to include user
interface AuthRequest extends Request {
  user?: {
    id: string;
    organizationId: string;
    email: string;
    role: string;
  };
}

const router = Router();

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Download media from WhatsApp and save locally
 * POST /api/media/download
 * Body: { mediaId: string }
 */
router.post('/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { mediaId } = req.body;
    const orgId = req.user?.organizationId;

    if (!mediaId) {
      return res.status(400).json({ error: 'mediaId is required' });
    }

    if (!orgId) {
      return res.status(401).json({ error: 'Organization not found' });
    }

    console.log(`📥 Downloading media: ${mediaId} for org: ${orgId}`);

    // Download the media content from WhatsApp
    const result = await downloadMediaContent(orgId, mediaId);

    if (!result.success || !result.buffer) {
      return res.status(500).json({ 
        error: result.error || 'Failed to download media from WhatsApp' 
      });
    }

    // Determine file extension from mime type
    const mimeType = result.mimeType || 'application/octet-stream';
    const ext = getExtensionFromMime(mimeType);
    
    // Generate unique filename
    const filename = `${uuidv4()}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Save the file
    fs.writeFileSync(filepath, result.buffer);

    console.log(`✅ Media saved: ${filename} (${result.buffer.length} bytes)`);

    // Generate public URL (relative to uploads folder)
    const publicUrl = `/uploads/${filename}`;

    return res.json({
      success: true,
      filename,
      url: publicUrl,
      mimeType: result.mimeType,
      size: result.buffer.length
    });

  } catch (error: any) {
    console.error('❌ Media download error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get media file info
 * GET /api/media/:filename
 */
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(filepath);
    const ext = path.extname(filename).slice(1);
    const mimeType = getMimeFromExtension(ext);

    return res.json({
      filename,
      size: stats.size,
      mimeType,
      createdAt: stats.birthtime,
      url: `/uploads/${filename}`
    });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Helper: Get file extension from MIME type
function getExtensionFromMime(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  };
  return mimeMap[mimeType] || 'bin';
}

// Helper: Get MIME type from extension
function getMimeFromExtension(ext: string): string {
  const extMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'txt': 'text/plain',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'mp3': 'audio/mpeg',
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
  };
  return extMap[ext] || 'application/octet-stream';
}

export default router;
