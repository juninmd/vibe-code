const fs = require('fs');

const path = 'packages/web/src/components/TaskTags.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'interface TaskTagsEditorProps {\n  tags: string[];\n  onChange: (tags: string[]) => void;\n}',
  'interface TaskTagsEditorProps {\n  tags: string[];\n  onChange: (tags: string[]) => void;\n  compact?: boolean;\n}'
);

content = content.replace(
  'export function TaskTagsEditor({ tags, onChange }: TaskTagsEditorProps) {',
  'export function TaskTagsEditor({ tags, onChange, compact }: TaskTagsEditorProps) {'
);

fs.writeFileSync(path, content);
