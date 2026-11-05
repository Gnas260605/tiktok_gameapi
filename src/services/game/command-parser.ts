/**
 * Command Parser - Pure functions for parsing Tu Tien Live chat commands.
 * References:
 * - docs/game/01_GDD.md §6
 * - docs/game/07_TestPlan.md TC-J05, TC-J06
 */

export type CommandType =
  | 'join'
  | 'gender'
  | 'info'
  | 'cultivation'
  | 'realm'
  | 'leaderboard'
  | 'top'
  | 'breakthrough';

export interface GameCommand {
  type: CommandType;
  name: CommandType;
  command: CommandType;
  args: string[];
  gender?: 'male' | 'female';
  raw: string;
}

/**
 * Normalizes user chat input:
 * 1. Trim leading/trailing whitespace
 * 2. Remove leading '/' if present
 * 3. Convert to lowercase
 * 4. Remove Vietnamese diacritics (NFD -> remove combining marks, đ/Đ -> d)
 * 5. Collapse consecutive whitespaces into a single space
 */
export function normalizeText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText.trim();
  if (text.startsWith('/')) {
    text = text.slice(1).trim();
  }

  // Decompose accented characters and remove combining diacritical marks
  text = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

  // Collapse consecutive whitespaces
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Parses raw chat comment into a GameCommand if the ENTIRE comment represents a command.
 * Returns null if the comment is normal conversation, contains typos, or is not an exact command match.
 */
export function parseCommand(rawText: string): GameCommand | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const normalized = normalizeText(rawText);
  if (!normalized) return null;

  // 1. Join / Tham Gia / Nhập Môn
  // Patterns: thamgia, tham gia, nhapmon, nhap mon
  // Parameters: nam, nu (or male, female)
  if (/^(thamgia|tham gia|nhapmon|nhap mon)(\s+(nam|nu))?$/.test(normalized)) {
    const parts = normalized.split(' ');
    let gender: 'male' | 'female' | undefined;
    const lastWord = parts[parts.length - 1];

    if (lastWord === 'nam') {
      gender = 'male';
    } else if (lastWord === 'nu') {
      gender = 'female';
    }

    const args = gender ? [lastWord] : [];

    return {
      type: 'join',
      name: 'join',
      command: 'join',
      args,
      gender,
      raw: rawText,
    };
  }

  // 2. Gender / Đổi Giới Tính
  // Patterns: gioitinh nam, gioitinh nu, gioi tinh nam, gioi tinh nu
  if (/^(gioitinh|gioi tinh)\s+(nam|nu)$/.test(normalized)) {
    const parts = normalized.split(' ');
    const genderWord = parts[parts.length - 1];
    const gender: 'male' | 'female' = genderWord === 'nam' ? 'male' : 'female';

    return {
      type: 'gender',
      name: 'gender',
      command: 'gender',
      args: [genderWord],
      gender,
      raw: rawText,
    };
  }

  // 3. Breakthrough / Độ Kiếp
  // Patterns: dokiep, do kiep
  if (/^(dokiep|do kiep)$/.test(normalized)) {
    return {
      type: 'breakthrough',
      name: 'breakthrough',
      command: 'breakthrough',
      args: [],
      raw: rawText,
    };
  }

  // 4. Cultivation / Tu Vi
  // Patterns: tuvi, tu vi
  if (/^(tuvi|tu vi)$/.test(normalized)) {
    return {
      type: 'cultivation',
      name: 'cultivation',
      command: 'cultivation',
      args: [],
      raw: rawText,
    };
  }

  // 5. Leaderboard / Bảng Xếp Hạng / Top / Xếp Hạng
  // Patterns: top, bang xep hang, bangxephang, xephang, xep hang
  if (/^(top|bang xep hang|bangxephang|xephang|xep hang)$/.test(normalized)) {
    return {
      type: 'leaderboard',
      name: 'leaderboard',
      command: 'leaderboard',
      args: [],
      raw: rawText,
    };
  }

  // 6. Info / Thông Tin
  // Patterns: thongtin, thong tin, info
  if (/^(thongtin|thong tin|info)$/.test(normalized)) {
    return {
      type: 'info',
      name: 'info',
      command: 'info',
      args: [],
      raw: rawText,
    };
  }

  // 7. Realm / Cảnh Giới
  // Patterns: canhgioi, canh gioi
  if (/^(canhgioi|canh gioi)$/.test(normalized)) {
    return {
      type: 'realm',
      name: 'realm',
      command: 'realm',
      args: [],
      raw: rawText,
    };
  }

  return null;
}

export const parse = parseCommand;

export class CommandParser {
  parse(rawText: string): GameCommand | null {
    return parseCommand(rawText);
  }

  normalizeText(rawText: string): string {
    return normalizeText(rawText);
  }
}
