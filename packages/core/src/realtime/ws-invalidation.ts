import { useQueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "@vibe-code/shared";

/**
 * Hook to handle WebSocket events and invalidate React Query cache
 * Called when server sends events like task_updated, skill_created, etc.
 */
export function useWsInvalidation() {
  const queryClient = useQueryClient();

  const handleWsMessage = (message: WsServerMessage) => {
    switch (message.type) {
      case "task_updated":
      case "task_created":
        console.debug("[WS] Invalidating tasks cache due to task event");
        queryClient.invalidateQueries({ queryKey: ["resources", "tasks"] });
        break;

      case "agent_log":
      case "agent_logs_batch":
        // Don't invalidate for logs - they're handled separately
        break;

      case "skill_created":
      case "skill_updated":
      case "skill_deleted":
        console.debug("[WS] Invalidating skills cache due to skill event");
        queryClient.invalidateQueries({ queryKey: ["resources", "skills"] });
        break;

      case "autopilot_created":
      case "autopilot_updated":
      case "autopilot_deleted":
        console.debug("[WS] Invalidating autopilots cache due to autopilot event");
        queryClient.invalidateQueries({ queryKey: ["resources", "autopilots"] });
        break;

      case "repo_updated":
        console.debug("[WS] Invalidating repositories cache");
        queryClient.invalidateQueries({ queryKey: ["repos"] });
        break;

      default:
        // Unknown message type - do nothing
        break;
    }
  };

  return { handleWsMessage };
}

/**
 * Hook that provides a callback to manually invalidate cache for a specific event
 */
export function useInvalidateOnEvent() {
  const queryClient = useQueryClient();

  return (eventType: WsServerMessage["type"]) => {
    switch (eventType) {
      case "task_updated":
      case "task_created":
        queryClient.invalidateQueries({ queryKey: ["resources", "tasks"] });
        break;
      case "skill_created":
      case "skill_updated":
      case "skill_deleted":
        queryClient.invalidateQueries({ queryKey: ["resources", "skills"] });
        break;
      case "autopilot_created":
      case "autopilot_updated":
      case "autopilot_deleted":
        queryClient.invalidateQueries({ queryKey: ["resources", "autopilots"] });
        break;
      default:
        break;
    }
  };
}
