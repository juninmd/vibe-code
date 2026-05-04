const fs = require('fs');
const path = 'packages/web/src/components/TaskTags.tsx';
let content = fs.readFileSync(path, 'utf8');

// Use 'compact' in TaskTagsEditor to suppress unused param lint warning
content = content.replace(
  '    <div className="flex flex-wrap gap-1 items-center min-h-[28px] bg-surface-hover border border-strong rounded-md px-2 py-1 focus-within:border-zinc-500">',
  '    <div className={`flex flex-wrap gap-1 items-center bg-surface-hover border border-strong rounded-md px-2 py-1 focus-within:border-zinc-500 ${compact ? "min-h-[24px]" : "min-h-[28px]"}`}>'
);
fs.writeFileSync(path, content);
