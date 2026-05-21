import crypto from 'crypto';

export function cleanText(text: string): string {
    let cleaned = text;
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    // Remove links
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/t\.me\/[^\s]+/g, '');
    // Remove mentions
    cleaned = cleaned.replace(/@[a-zA-Z0-9_]+/g, '');

    return cleaned.trim();
}

export function getHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}
