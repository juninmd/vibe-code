import { describe, expect, it, mock, spyOn, beforeEach } from "bun:test";
import { getWorkspaceContext, requireWorkspaceContext } from "../workspace-context";

describe("workspace-context", () => {
  let mockDb: any;
  let mockUser: any;
  let mockContext: any;

  beforeEach(() => {
    mockDb = {
      workspaces: {
        get: mock().mockReturnValue(undefined),
        getBySlug: mock().mockReturnValue(undefined),
        create: mock(),
      },
      settings: {
        get: mock().mockReturnValue(undefined),
        set: mock(),
      },
    };

    mockUser = {
      username: "testuser",
      displayName: "Test User",
    };

    mockContext = {
      req: {
        method: "GET",
        header: mock().mockReturnValue(undefined),
        query: mock().mockReturnValue(undefined),
        json: mock().mockImplementation(() => Promise.reject(new Error("No body"))),
      },
      env: {},
    };
  });

  describe("getWorkspaceContext", () => {
    it("should return null if no user is provided", async () => {
      const result = await getWorkspaceContext(mockContext, mockDb, null);
      expect(result).toBeNull();
    });

    it("should extract workspaceId from env priority", async () => {
      mockContext.env.workspaceId = "env-ws";
      mockContext.req.header.mockReturnValue("header-ws");

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("env-ws");
      expect(mockDb.settings.set).toHaveBeenCalledWith("user_workspace:testuser", "env-ws");
    });

    it("should extract workspaceId from header", async () => {
      mockContext.req.header.mockReturnValue("header-ws");
      mockContext.req.query.mockReturnValue("query-ws");

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("header-ws");
    });

    it("should extract workspaceId from query", async () => {
      mockContext.req.query.mockReturnValue("query-ws");

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("query-ws");
    });

    it("should extract workspaceId from body for POST requests", async () => {
      mockContext.req.method = "POST";
      mockContext.req.json.mockImplementation(() => Promise.resolve({ workspace_id: "body-ws" }));

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("body-ws");
    });

    it("should fallback to generating default workspaceId if none provided", async () => {
      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("ws-testuser");
      expect(mockDb.settings.set).toHaveBeenCalledWith("user_workspace:testuser", "ws-testuser");
    });

    it("should use existing default workspaceId if none provided", async () => {
      mockDb.settings.get.mockImplementation((key: string) => {
        if (key === "user_workspace:testuser") return "existing-ws";
        return undefined;
      });

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("existing-ws");
    });

    it("should create default workspace when no mapping exists", async () => {
      mockContext.req.header.mockReturnValue("my-custom-ws");

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result?.workspaceId).toBe("my-custom-ws");
      expect(mockDb.settings.set).toHaveBeenCalledWith("user_workspace:testuser", "my-custom-ws");
      expect(mockDb.workspaces.create).toHaveBeenCalledWith({
        id: "my-custom-ws",
        name: "Test User",
        slug: "testuser",
        description: "Default GitHub workspace",
      });
    });

    it("should deny access if user requests different workspace than authorized", async () => {
      mockContext.req.header.mockReturnValue("other-ws");
      mockDb.settings.get.mockImplementation((key: string) => {
        if (key === "user_workspace:testuser") return "authorized-ws";
        return undefined;
      });

      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("should handle slug collision when creating workspace", async () => {
      mockContext.req.header.mockReturnValue("my-ws");
      mockDb.workspaces.getBySlug.mockReturnValue(true); // Simulate slug exists
      mockUser.username = "---"; // tests slugify fallback

      const result = await getWorkspaceContext(mockContext, mockDb, mockUser);
      expect(mockDb.workspaces.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: "personal-my-ws" // fallback slug 'personal' + workspaceId
        })
      );
    });
  });

  describe("requireWorkspaceContext", () => {
    it("should return workspaceId on success", async () => {
      mockContext.req.header.mockReturnValue("ws-1");
      const result = await requireWorkspaceContext(mockContext, mockDb, mockUser);
      expect(result).toBe("ws-1");
    });

    it("should return null on failure", async () => {
      const result = await requireWorkspaceContext(mockContext, mockDb, null);
      expect(result).toBeNull();
    });
  });
});
