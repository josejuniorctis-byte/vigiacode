const supportsColor =
  process.stdout.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb';

const paint = (code: number, text: string): string =>
  supportsColor ? `\u001b[${code}m${text}\u001b[0m` : text;

const dim = (text: string): string => paint(2, text);
const bold = (text: string): string => paint(1, text);
const cyan = (text: string): string => paint(36, text);
const green = (text: string): string => paint(32, text);
const yellow = (text: string): string => paint(33, text);
const red = (text: string): string => paint(31, text);

function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

/**
 * Logger da CLI: mensagens curtas, em português, sempre no stdout
 * (erros também, para manter a leitura simples no terminal).
 */
export const logger = {
  blank(): void {
    write('');
  },

  intro(message: string): void {
    write('');
    write(`${cyan('⚓')} ${bold(message)}`);
  },

  info(message: string): void {
    write(`${cyan('•')} ${message}`);
  },

  /** Linha de evento do vigia, já com o emoji e sem bullet. */
  event(message: string): void {
    write(message);
  },

  success(message: string): void {
    write(`${green('✔')} ${message}`);
  },

  warn(message: string): void {
    write(`${yellow('!')} ${message}`);
  },

  error(message: string): void {
    process.stderr.write(`${red('✖')} ${message}\n`);
  },

  detail(message: string): void {
    write(`  ${dim(message)}`);
  },

  hint(message: string): void {
    write(`  ${dim(`→ ${message}`)}`);
  },

  section(title: string): void {
    write('');
    write(bold(title));
  },
};

export type Logger = typeof logger;
