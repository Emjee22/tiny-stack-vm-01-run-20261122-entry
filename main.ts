// Tiny stack VM (make.fun tiny-stack-vm-01-run-20261122), written from ISA.md:
// 32-bit wrapping values, 256-value stack, 64-deep call stack, 256 words of
// memory, input/output, ten traps (exit codes 2-11).
// Deterministic: no clock, no random, no network.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const MAX_STEPS = 1000000;
const MAX_OUT = 65536;

// Per-opcode tables. Unknown opcodes stay KNOWN = 0.
const KNOWN = new Uint8Array(256);
const NEED = new Int8Array(256);
const PUSH = new Int8Array(256);
const IMM = new Int8Array(256);
function mark(ops: number[], need: number, push: number, imm: number): void {
  for (const o of ops) { KNOWN[o] = 1; NEED[o] = need; PUSH[o] = push; IMM[o] = imm; }
}
mark([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22], 2, 1, 0);
mark([0x17, 0x1b, 0x04, 0x40], 1, 1, 0);
mark([0x03, 0x50, 0x51, 0x53], 1, 0, 0);
mark([0x31, 0x32], 1, 0, 2);
mark([0x41, 0x05], 2, 0, 0);
mark([0x06], 2, 1, 0);
mark([0x07], 3, 0, 0);
mark([0x01], 0, 1, 1);
mark([0x02], 0, 1, 4);
mark([0x52], 0, 1, 0);
mark([0x00, 0x34], 0, 0, 0);
mark([0x30, 0x33], 0, 0, 2);

function run(prog: Buffer, input: Buffer): { out: Buffer; code: number } {
  const mem = new Int32Array(256);
  const st = new Int32Array(256);
  const cs = new Int32Array(64);
  const out: number[] = [];
  let sp = 0, cp = 0, pc = 0, ip = 0, steps = 0;
  const done = (code: number): { out: Buffer; code: number } => ({ out: Buffer.from(out), code });
  while (true) {
    if (steps >= MAX_STEPS) return done(10);
    if (pc < 0 || pc >= prog.length) return done(9);
    const op = prog[pc];
    if (!KNOWN[op]) return done(5);
    const imm = IMM[op];
    if (pc + 1 + imm > prog.length) return done(9);
    steps++;
    if (sp < NEED[op]) return done(2);
    if (sp - NEED[op] + PUSH[op] > 256) return done(3);
    const next = pc + 1 + imm;
    const raw16 = imm === 2 ? prog[pc + 1] | (prog[pc + 2] << 8) : 0;
    const off = raw16 >= 32768 ? raw16 - 65536 : raw16;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: st[sp++] = (prog[pc + 1] << 24) >> 24; pc = next; break;
      case 0x02: st[sp++] = prog.readInt32LE(pc + 1); pc = next; break;
      case 0x03: sp--; pc = next; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; pc = next; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; pc = next; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; pc = next; break;
      case 0x07: { const a = st[sp - 3]; const b = st[sp - 2]; st[sp - 3] = b; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; pc = next; break; }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[--sp];
        const a = st[--sp];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = Math.trunc(a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return done(4); r = (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        st[sp++] = r;
        pc = next;
        break;
      }
      case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; pc = next; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; pc = next; break;
      case 0x30: pc = next + off; break;
      case 0x31: { const v = st[--sp]; pc = v === 0 ? next + off : next; break; }
      case 0x32: { const v = st[--sp]; pc = v !== 0 ? next + off : next; break; }
      case 0x33: if (cp >= 64) return done(7); cs[cp++] = next; pc = raw16; break;
      case 0x34: if (cp === 0) return done(8); pc = cs[--cp]; break;
      case 0x40: { const addr = st[sp - 1]; if (addr < 0 || addr > 255) return done(6); st[sp - 1] = mem[addr]; pc = next; break; }
      case 0x41: { const addr = st[--sp]; const v = st[--sp]; if (addr < 0 || addr > 255) return done(6); mem[addr] = v; pc = next; break; }
      case 0x50: {
        const v = st[--sp];
        const s = String(v);
        if (out.length + s.length > MAX_OUT) return done(11);
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        pc = next;
        break;
      }
      case 0x51: { const v = st[--sp]; if (out.length + 1 > MAX_OUT) return done(11); out.push(v & 255); pc = next; break; }
      case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; pc = next; break;
      case 0x53: return done(st[--sp] & 255);
      default: return done(5);
    }
  }
}

function main(): void {
  const ids = readdirSync(IN_DIR).sort();
  for (const id of ids) {
    const dir = join(IN_DIR, id);
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { isDir = false; }
    if (!isDir || !existsSync(join(dir, "program.bin"))) continue;
    const prog = readFileSync(join(dir, "program.bin"));
    let input = Buffer.alloc(0);
    try { input = readFileSync(join(dir, "input.bin")); } catch { input = Buffer.alloc(0); }
    const { out, code } = run(prog, input);
    const od = join(OUT_DIR, id);
    mkdirSync(od, { recursive: true });
    writeFileSync(join(od, "stdout.bin"), out);
    writeFileSync(join(od, "exit.txt"), code + "\n");
  }
}
main();
