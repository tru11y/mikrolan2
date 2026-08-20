import { NotFoundException } from '@nestjs/common';
import {
  extensionForMimetype,
  hasValidImageSignature,
  resolveProofFile,
} from './subscriptions.service';

// Synthetic fixtures only — no real payment proof is used anywhere here.
const REAL_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const REAL_PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const HTML_PAYLOAD = Buffer.from('<html><script>alert(1)</script></html>');
const EMPTY_BUFFER = Buffer.alloc(0);

describe('extensionForMimetype (FIND-005: whitelist, never client input)', () => {
  it('accepts image/jpeg', () => {
    expect(extensionForMimetype('image/jpeg')).toBe('jpg');
  });

  it('accepts image/png', () => {
    expect(extensionForMimetype('image/png')).toBe('png');
  });

  it('rejects text/html', () => {
    expect(extensionForMimetype('text/html')).toBeUndefined();
  });

  it('rejects image/svg+xml', () => {
    expect(extensionForMimetype('image/svg+xml')).toBeUndefined();
  });

  it('rejects application/javascript', () => {
    expect(extensionForMimetype('application/javascript')).toBeUndefined();
  });

  it('rejects application/x-msdownload (executable)', () => {
    expect(extensionForMimetype('application/x-msdownload')).toBeUndefined();
  });

  it('rejects application/zip (archive)', () => {
    expect(extensionForMimetype('application/zip')).toBeUndefined();
  });

  it('rejects application/pdf (not a supported proof type per current business rules)', () => {
    expect(extensionForMimetype('application/pdf')).toBeUndefined();
  });
});

describe('hasValidImageSignature (FIND-005 Scenario D: MIME spoofing)', () => {
  it('accepts a real JPEG signature claimed as image/jpeg', () => {
    expect(hasValidImageSignature(REAL_JPEG_HEADER, 'image/jpeg')).toBe(true);
  });

  it('accepts a real PNG signature claimed as image/png', () => {
    expect(hasValidImageSignature(REAL_PNG_HEADER, 'image/png')).toBe(true);
  });

  it('rejects HTML content claimed as image/png (the core MIME-spoofing attack)', () => {
    expect(hasValidImageSignature(HTML_PAYLOAD, 'image/png')).toBe(false);
  });

  it('rejects HTML content claimed as image/jpeg', () => {
    expect(hasValidImageSignature(HTML_PAYLOAD, 'image/jpeg')).toBe(false);
  });

  it('rejects a JPEG signature claimed as image/png (cross-mismatch)', () => {
    expect(hasValidImageSignature(REAL_JPEG_HEADER, 'image/png')).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(hasValidImageSignature(EMPTY_BUFFER, 'image/jpeg')).toBe(false);
  });

  it('rejects any buffer for an unsupported mimetype', () => {
    expect(hasValidImageSignature(REAL_JPEG_HEADER, 'text/html')).toBe(false);
  });
});

describe('resolveProofFile (FIND-004/FIND-005: path traversal + legacy compatibility)', () => {
  it('resolves a legacy-format filename (old public /uploads/proofs/ record)', () => {
    const { ext } = resolveProofFile('/uploads/proofs/abc12345-1700000000000.jpg');
    expect(ext).toBe('jpg');
  });

  it('resolves a new-format filename (private storage record)', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const { ext } = resolveProofFile(`/private-uploads/proofs/${uuid}.png`);
    expect(ext).toBe('png');
  });

  it('normalizes a legacy .jpeg extension to jpg for MIME lookup', () => {
    const { ext } = resolveProofFile('/uploads/proofs/abc-1700000000000.jpeg');
    expect(ext).toBe('jpg');
  });

  it('neutralizes a ../ path traversal attempt (basename() strips all directory components, staying inside root)', () => {
    const { path } = resolveProofFile('/uploads/proofs/../../etc/passwd.jpg');
    expect(path).not.toMatch(/etc[\\/]passwd/);
    expect(path.endsWith('passwd.jpg')).toBe(true);
  });

  it('neutralizes an absolute path smuggled as the stored value (reduced to a bare filename, not followed)', () => {
    expect(() => resolveProofFile('/etc/passwd.jpg')).not.toThrow(); // basename() strips all directory components — no traversal occurs
  });

  it('confines an absolute-path-smuggled value to the resolved root, not the real /etc', () => {
    const { path } = resolveProofFile('/etc/passwd.jpg');
    expect(path).not.toContain('etc');
    expect(path.endsWith('passwd.jpg')).toBe(true);
  });

  it('rejects a double extension disguising an HTML payload (proof.jpg.html)', () => {
    expect(() => resolveProofFile('/uploads/proofs/proof.jpg.html')).toThrow(NotFoundException);
  });

  it('rejects an .html extension outright', () => {
    expect(() => resolveProofFile('/uploads/proofs/shell.html')).toThrow(NotFoundException);
  });

  it('rejects an .svg extension outright', () => {
    expect(() => resolveProofFile('/uploads/proofs/image.svg')).toThrow(NotFoundException);
  });

  it('rejects a filename with unexpected separators/characters', () => {
    expect(() => resolveProofFile('/uploads/proofs/weird;name|here.jpg')).toThrow(NotFoundException);
  });

  it('neutralizes a Windows-style traversal attempt (basename() semantics are platform-dependent: win32 strips backslashes like separators and yields a safe bare filename; POSIX instead fails the character whitelist and throws — both outcomes prevent traversal)', () => {
    let path: string | undefined;
    try {
      path = resolveProofFile('/uploads/proofs/..\\..\\windows\\win.ini.jpg').path;
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      return;
    }
    expect(path).not.toMatch(/windows[\\/]win\.ini/);
  });
});
