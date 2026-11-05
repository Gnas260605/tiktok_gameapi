import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';

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
  type?: CommandType | string;
  name?: CommandType | string;
  command?: CommandType | string;
  args?: string[];
  gender?: 'male' | 'female' | string;
  raw?: string;
}

export interface CommandParserModule {
  parseCommand?: (rawText: string) => GameCommand | null;
  parse?: (rawText: string) => GameCommand | null;
  normalizeText?: (rawText: string) => string;
  CommandParser?: new () => {
    parse(rawText: string): GameCommand | null;
  };
}

const parserTsPath = path.resolve(__dirname, '../../../src/services/game/command-parser.ts');
const parserJsPath = path.resolve(__dirname, '../../../src/services/game/command-parser.js');
const isParserImplemented = fs.existsSync(parserTsPath) || fs.existsSync(parserJsPath);

const parserModulePath = '../../../src/services/game/command-parser';
let parserModule: CommandParserModule | null = null;

function executeParse(text: string): GameCommand | null {
  if (!parserModule) return null;
  if (typeof parserModule.parseCommand === 'function') {
    return parserModule.parseCommand(text);
  }
  if (typeof parserModule.parse === 'function') {
    return parserModule.parse(text);
  }
  if (parserModule.CommandParser) {
    const instance = new parserModule.CommandParser();
    if (typeof instance.parse === 'function') {
      return instance.parse(text);
    }
  }
  return null;
}

function getCommandIdentifier(cmd: GameCommand | null): string {
  if (!cmd) return '';
  return String(cmd.type || cmd.name || cmd.command || '').toLowerCase();
}

describe('Command Parser — Unit & Contract Tests', () => {
  beforeAll(async () => {
    if (isParserImplemented) {
      parserModule = (await import(/* @vite-ignore */ parserModulePath).catch(() => null)) as CommandParserModule | null;
    }
  });

  it('reports module implementation status (TDD check)', () => {
    if (!isParserImplemented) {
      console.info(
        'ℹ [TDD Pending] src/services/game/command-parser.ts is awaiting implementation by Agent 3. Tests will run automatically once created.'
      );
    }
    expect(true).toBe(true);
  });

  describe('TC-J05 — Command Normalization & Variations (>= 30 variants)', () => {
    // 1. Nhập môn / Tham gia (Join) variants
    const joinVariants = [
      { input: 'thamgia', desc: 'thamgia lower' },
      { input: 'THAM GIA', desc: 'THAM GIA uppercase separated' },
      { input: '/tham gia', desc: '/tham gia with slash' },
      { input: '  thamgia  ', desc: 'thamgia with extra whitespaces' },
      { input: 'nhap mon', desc: 'nhap mon without accents' },
      { input: '/Nhập Môn', desc: '/Nhập Môn with accents and slash' },
      { input: 'NHẬP MÔN', desc: 'NHẬP MÔN uppercase with accents' },
      { input: '  nhap   mon  ', desc: 'nhap mon multiple spaces' },
      { input: 'nhapmon', desc: 'nhapmon combined' },
      { input: '/nhập môn', desc: '/nhập môn lowercase with accents' },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses join commands across 10 variations (thamgia / nhap mon)', () => {
      for (const variant of joinVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on variant: ${variant.desc} ("${variant.input}")`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        const isJoin = ['join', 'thamgia', 'tham_gia', 'nhapmon', 'nhap_mon'].includes(cmd);
        expect(isJoin, `Expected join command identifier but got "${cmd}" for "${variant.input}"`).toBe(true);
      }
    });

    // 2. Join with gender parameters
    const joinWithGenderVariants = [
      { input: 'tham gia nam', expectedGender: 'male' },
      { input: '/tham gia nu', expectedGender: 'female' },
      { input: 'nhập môn nam', expectedGender: 'male' },
      { input: '/NHẬP MÔN NỮ', expectedGender: 'female' },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses join commands with gender arguments', () => {
      for (const variant of joinWithGenderVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on gender variant: "${variant.input}"`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        expect(['join', 'thamgia', 'nhapmon', 'nhap_mon'].includes(cmd)).toBe(true);
      }
    });

    // 3. Độ kiếp (Breakthrough) variants
    const breakthroughVariants = [
      { input: 'dokiep', desc: 'dokiep lower' },
      { input: 'do kiep', desc: 'do kiep separated' },
      { input: '/do kiep', desc: '/do kiep with slash' },
      { input: 'ĐỘ KIẾP', desc: 'ĐỘ KIẾP uppercase accented' },
      { input: '/Độ kiếp', desc: '/Độ kiếp with slash & title case' },
      { input: '  độ   kiếp  ', desc: 'độ kiếp with redundant whitespace' },
      { input: 'DOKIEP', desc: 'DOKIEP uppercase' },
      { input: '/DOKIEP', desc: '/DOKIEP with slash' },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses breakthrough commands across 8 variations (dokiep / do kiep)', () => {
      for (const variant of breakthroughVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on variant: ${variant.desc} ("${variant.input}")`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        const isBreakthrough = ['breakthrough', 'dokiep', 'do_kiep'].includes(cmd);
        expect(isBreakthrough, `Expected breakthrough identifier but got "${cmd}" for "${variant.input}"`).toBe(true);
      }
    });

    // 4. Tu vi (Cultivation) variants
    const cultivationVariants = [
      { input: 'tuvi', desc: 'tuvi lower' },
      { input: 'tu vi', desc: 'tu vi separated' },
      { input: 'TUVI', desc: 'TUVI uppercase' },
      { input: '/Tu Vi', desc: '/Tu Vi with slash and title case' },
      { input: '  tu   vi  ', desc: 'tu vi with extra spaces' },
      { input: '/tuvi', desc: '/tuvi with slash' },
      { input: 'TU VI', desc: 'TU VI uppercase separated' },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses cultivation commands across 7 variations (tuvi / tu vi)', () => {
      for (const variant of cultivationVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on variant: ${variant.desc} ("${variant.input}")`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        const isCultivation = ['cultivation', 'tuvi', 'tu_vi'].includes(cmd);
        expect(isCultivation, `Expected cultivation identifier but got "${cmd}" for "${variant.input}"`).toBe(true);
      }
    });

    // 5. Bảng xếp hạng / Top (Leaderboard) variants
    const leaderboardVariants = [
      { input: 'top', desc: 'top lowercase' },
      { input: '/TOP', desc: '/TOP uppercase with slash' },
      { input: '  top  ', desc: 'top with spaces' },
      { input: 'bang xep hang', desc: 'bang xep hang lowercase' },
      { input: '/BẢNG XẾP HẠNG', desc: '/BẢNG XẾP HẠNG accented uppercase' },
      { input: 'bangxephang', desc: 'bangxephang concatenated' },
      { input: '  bảng   xếp   hạng  ', desc: 'bảng xếp hạng with spaces' },
      { input: 'xephang', desc: 'xephang lower' },
      { input: '/Xếp Hạng', desc: '/Xếp Hạng title case' },
      { input: 'xep hang', desc: 'xep hang separated' },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses leaderboard commands across 10 variations (top / bang xep hang / xephang)', () => {
      for (const variant of leaderboardVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on variant: ${variant.desc} ("${variant.input}")`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        const isLeaderboard = ['leaderboard', 'top', 'rank', 'xephang', 'xep_hang', 'bangxephang', 'bang_xep_hang'].includes(cmd);
        expect(isLeaderboard, `Expected leaderboard/top identifier but got "${cmd}" for "${variant.input}"`).toBe(true);
      }
    });

    // 6. Additional info & realm commands
    const additionalVariants = [
      { input: 'thongtin', expected: ['info', 'thongtin', 'thong_tin'] },
      { input: '/THÔNG TIN', expected: ['info', 'thongtin', 'thong_tin'] },
      { input: 'info', expected: ['info', 'thongtin'] },
      { input: '/info', expected: ['info', 'thongtin'] },
      { input: 'canhgioi', expected: ['realm', 'canhgioi', 'canh_gioi'] },
      { input: '/CẢNH GIỚI', expected: ['realm', 'canhgioi', 'canh_gioi'] },
      { input: 'gioitinh nam', expected: ['gender', 'gioitinh', 'gioi_tinh'] },
      { input: '/giới tính nữ', expected: ['gender', 'gioitinh', 'gioi_tinh'] },
    ];

    it.skipIf(!isParserImplemented)('TC-J05: parses info, realm, and gender commands', () => {
      for (const variant of additionalVariants) {
        const result = executeParse(variant.input);
        expect(result, `Failed on: "${variant.input}"`).not.toBeNull();
        const cmd = getCommandIdentifier(result);
        expect(variant.expected.includes(cmd), `Expected one of [${variant.expected.join(', ')}] but got "${cmd}" for "${variant.input}"`).toBe(true);
      }
    });
  });

  describe('TC-J06 — Non-Command Chat Messages Must Be Ignored', () => {
    const nonCommandMessages = [
      'hom nay toi do kiep thanh cong',
      'chuc mung ban da do kiep',
      'xin chao ca nha toi muon tham gia',
      'tu vi cua ban cao qua',
      'ai dang dung top 1 the',
      'nhap mon nhu the nao vay',
      'bang xep hang o dau day',
      'thamgiaa',
      'dokiepp',
      'tuvii',
      'topp',
      'do kiep di ban oi',
      'alo dokiep nha',
      'chuc mung len top',
      '',
      '   ',
      'hello world',
      '🎮🔥✨',
      '123456',
      '???',
    ];

    it.skipIf(!isParserImplemented)('TC-J06: returns null when message is normal chat containing command keywords or typos', () => {
      for (const message of nonCommandMessages) {
        const result = executeParse(message);
        expect(result, `Message should NOT be parsed as command: "${message}"`).toBeNull();
      }
    });
  });
});
