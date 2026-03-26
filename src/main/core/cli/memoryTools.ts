// src/main/core/cli/memoryTools.ts
// Anthropic tool definitions for the three memory tools.
// These are added to the tool list alongside shell and browser tools.

import type Anthropic from '@anthropic-ai/sdk';

export const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'memory_store',
    description:
      'Store a fact about the user in persistent memory. Call this when the user explicitly asks you to remember something, or when you learn something important about them that should persist across conversations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['preference', 'account', 'workflow', 'fact', 'context'],
          description:
            'preference: editor/language/style preferences. account: names/handles/emails/role. workflow: tools/processes they follow. fact: location/background/skills/projects. context: current task/goals/deadlines.',
        },
        key: {
          type: 'string',
          description: 'Short snake_case label, e.g. preferred_editor, home_city, current_project. Max 100 chars.',
        },
        value: {
          type: 'string',
          description: 'The fact to store. One sentence max. Max 500 chars.',
        },
        source: {
          type: 'string',
          enum: ['user', 'agent'],
          description:
            'Use "user" if the user explicitly asked you to remember this. Use "agent" if you decided to store it.',
        },
      },
      required: ['category', 'key', 'value', 'source'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Search persistent memory for stored facts about the user. Use this for explicit recall requests beyond what was auto-injected in context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for, e.g. "editor preference" or "current project".',
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Defaults to 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_forget',
    description:
      'Delete a stored fact from persistent memory. Call this when the user asks you to forget something.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string',
          description: 'The snake_case key of the fact to delete.',
        },
        category: {
          type: 'string',
          description:
            'Optional. If provided, only deletes the fact in this category. If omitted, deletes all facts with this key.',
        },
      },
      required: ['key'],
    },
  },
];
