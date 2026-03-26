import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

/** Execute a shell or file-edit tool call by name+args. Returns a result string. */
export async function executeShellTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'shell_exec' || name === 'bash') {
      const command = (args.command ?? args.cmd) as string;
      const { stdout, stderr } = await execAsync(command);
      return stdout || stderr || 'Command executed successfully with no output.';
    }
    if (name === 'file_edit' || name === 'str_replace_based_edit_tool') {
      const cmd = args.command as string;
      const filePath = args.path as string;
      if (cmd === 'view') {
        return fs.readFileSync(filePath, 'utf-8');
      }
      if (cmd === 'create') {
        fs.writeFileSync(filePath, (args.file_text as string) ?? '', 'utf-8');
        return `File created at ${filePath}`;
      }
      if (cmd === 'str_replace') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const count = text.split(args.old_str as string).length - 1;
        if (count === 0) return 'Error: old_str not found in file.';
        if (count > 1) return 'Error: old_str found multiple times.';
        fs.writeFileSync(filePath, text.replace(args.old_str as string, args.new_str as string), 'utf-8');
        return 'File updated successfully.';
      }
      return `Executed ${cmd} on ${filePath} (unrecognised command).`;
    }
    return `Error: Unknown tool ${name}`;
  } catch (err: unknown) {
    return `Error executing tool: ${(err as Error).message}`;
  }
}

/** OpenAI-compatible tool definitions for shell + file access. */
export const SHELL_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'shell_exec',
      description: 'Execute a bash shell command on the local system.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_edit',
      description: 'Read and edit files on the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Action: view, create, or str_replace.' },
          path: { type: 'string', description: 'Absolute file path.' },
          file_text: { type: 'string', description: 'File content (required for create).' },
          old_str: { type: 'string', description: 'Text to replace (required for str_replace).' },
          new_str: { type: 'string', description: 'Replacement text (required for str_replace).' },
        },
        required: ['command', 'path'],
      },
    },
  },
];
