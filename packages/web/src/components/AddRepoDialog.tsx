import { useState } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { url: string; defaultBranch?: string }) => void;
}

export function AddRepoDialog({ open, onClose, onSubmit }: AddRepoDialogProps) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({
      url: url.trim(),
      defaultBranch: branch.trim() || undefined,
    });
    setUrl("");
    setBranch("main");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add Repository">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Repository URL *
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
            required
          />
          <p className="text-xs text-zinc-600 mt-1">
            GitHub URL or local path
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Default Branch
          </label>
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!url.trim()}>
            Add Repository
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
