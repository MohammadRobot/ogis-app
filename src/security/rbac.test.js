import { describe, expect, it, vi } from "vitest"
import { authorize, can, canTransition } from "./rbac"

describe("can", () => {
  it("allows inspector to update assigned draft inspection with allowed fields", () => {
    const result = can("inspector", "update", "inspections", {
      actor: { id: 10, team_ids: [1] },
      inspection: { assigned_to: 10, created_by: 99, status: "draft", team_id: 1 },
      patchFields: ["notes"],
      target: { team_id: 1 },
    })

    expect(result).toBe(true)
  })

  it("denies inspector update when inspection is submitted", () => {
    const result = can("inspector", "update", "inspections", {
      actor: { id: 10, team_ids: [1] },
      inspection: { assigned_to: 10, created_by: 99, status: "submitted", team_id: 1 },
      patchFields: ["notes"],
      target: { team_id: 1 },
    })

    expect(result).toBe(false)
  })

  it("allows supervisor approve in team scope and denies outside scope", () => {
    const allowed = can("supervisor", "approve", "inspection_reviews", {
      actor: { id: 7, team_ids: [5] },
      target: { team_id: 5 },
    })

    const denied = can("supervisor", "approve", "inspection_reviews", {
      actor: { id: 7, team_ids: [5] },
      target: { team_id: 9 },
    })

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })

  it("allows admin wildcard access", () => {
    const result = can("admin", "delete", "users", {
      actor: { id: 1, team_ids: [] },
    })
    expect(result).toBe(true)
  })
})

describe("canTransition", () => {
  it("enforces inspector transitions", () => {
    expect(canTransition("inspector", "draft", "submitted")).toBe(true)
    expect(canTransition("inspector", "submitted", "approved")).toBe(false)
  })

  it("allows admin to transition from any status", () => {
    expect(canTransition("admin", "submitted", "closed")).toBe(true)
  })
})

describe("authorize", () => {
  it("calls next when request is allowed", () => {
    const middleware = authorize("read", "sites")
    const req = { user: { id: 11, roles: ["inspector"] } }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    const next = vi.fn()

    middleware(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it("returns 403 when request is denied", () => {
    const middleware = authorize("delete", "sites")
    const req = { user: { id: 11, roles: ["inspector"] } }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    const next = vi.fn()

    middleware(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" })
  })
})

