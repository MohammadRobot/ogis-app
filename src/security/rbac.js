const DEFAULT_POLICY = {
  roles: {
    inspector: {
      profile: {
        read: { scope: "self", conditions: ["isSelf"] },
        update: { scope: "self", conditions: ["isSelf", "allowedSelfProfileFields"] },
      },
      teams: { read: { scope: "member_of" } },
      sites: { read: { scope: "all" } },
      site_assets: { read: { scope: "all" } },
      checklist_templates: { read: { scope: "all" } },
      inspections: {
        read: { scope: "assigned_or_created" },
        create: { scope: "team_scope" },
        update: {
          scope: "assigned_or_created",
          conditions: ["draftOrReopened", "allowedInspectorUpdateFields"],
        },
        submit: { scope: "assigned_or_created", conditions: ["draftOrReopened"] },
      },
      inspection_item_responses: {
        read: { scope: "assigned_inspection" },
        create: { scope: "assigned_inspection", conditions: ["draftOrReopened"] },
        update: { scope: "assigned_inspection", conditions: ["draftOrReopened"] },
      },
      media_files: {
        read: { scope: "assigned_inspection" },
        create: { scope: "assigned_inspection", conditions: ["draftOrReopened"] },
        update: { scope: "assigned_inspection", conditions: ["draftOrReopened"] },
      },
      inspection_reviews: { read: { scope: "assigned_inspection" } },
      report_exports: {
        read: { scope: "own_inspection" },
        export: { scope: "own_inspection" },
      },
      audit_logs: { read: { scope: "own_actions" } },
    },
    supervisor: {
      profile: {
        read: { scope: "self" },
        update: { scope: "self", conditions: ["allowedSelfProfileFields"] },
      },
      users: { read: { scope: "all" } },
      roles: { read: { scope: "all" } },
      teams: { read: { scope: "all" } },
      team_members: { read: { scope: "all" } },
      sites: {
        read: { scope: "all" },
        create: { scope: "all" },
        update: { scope: "all" },
      },
      site_assets: {
        read: { scope: "all" },
        create: { scope: "all" },
        update: { scope: "all" },
      },
      checklist_templates: {
        read: { scope: "all" },
        create: { scope: "all" },
        update: { scope: "all" },
      },
      inspections: {
        read: { scope: "team_scope" },
        create: { scope: "team_scope" },
        update: { scope: "team_scope" },
        submit: { scope: "team_scope" },
      },
      inspection_item_responses: {
        read: { scope: "team_scope" },
        update: { scope: "team_scope", conditions: ["submittedOrInReviewOrReopened"] },
      },
      media_files: {
        read: { scope: "team_scope" },
        create: { scope: "team_scope" },
        update: { scope: "team_scope" },
      },
      inspection_reviews: {
        read: { scope: "team_scope" },
        create: { scope: "team_scope" },
        review: { scope: "team_scope" },
        approve: { scope: "team_scope" },
        reject: { scope: "team_scope" },
        reopen: { scope: "team_scope" },
      },
      report_exports: {
        read: { scope: "team_scope" },
        export: { scope: "team_scope" },
      },
      audit_logs: { read: { scope: "team_scope" } },
      backup_runs: { read: { scope: "all" } },
    },
    admin: {
      "*": {
        read: { scope: "all" },
        create: { scope: "all" },
        update: { scope: "all" },
        delete: { scope: "all" },
        submit: { scope: "all" },
        review: { scope: "all" },
        approve: { scope: "all" },
        reject: { scope: "all" },
        reopen: { scope: "all" },
        export: { scope: "all" },
        manage: { scope: "all" },
      },
    },
  },
  statusTransitions: {
    inspector: {
      draft: ["submitted"],
      reopened: ["submitted"],
    },
    supervisor: {
      submitted: ["in_review", "approved", "rejected", "reopened"],
      in_review: ["approved", "rejected", "reopened"],
      reopened: ["in_review", "approved", "rejected"],
    },
    admin: {
      "*": ["draft", "submitted", "in_review", "approved", "rejected", "reopened", "closed"],
    },
  },
}

const DEFAULT_ALLOWED_INSPECTOR_FIELDS = new Set([
  "notes",
  "latitude",
  "longitude",
  "geometry",
  "geometry_json",
])
const DEFAULT_ALLOWED_PROFILE_FIELDS = new Set(["full_name", "password", "email"])

function includesAny(targetValues, actorValues) {
  const targetSet = new Set(targetValues || [])
  return (actorValues || []).some((value) => targetSet.has(value))
}

function createDefaultConditions() {
  return {
    isSelf: (ctx) => ctx?.actor?.id != null && ctx?.target?.user_id != null && ctx.actor.id === ctx.target.user_id,
    isAssignee: (ctx) =>
      ctx?.actor?.id != null &&
      ctx?.inspection?.assigned_to != null &&
      ctx.actor.id === ctx.inspection.assigned_to,
    isCreator: (ctx) =>
      ctx?.actor?.id != null &&
      ctx?.inspection?.created_by != null &&
      ctx.actor.id === ctx.inspection.created_by,
    teamMatch: (ctx) => {
      const actorTeamIds = ctx?.actor?.team_ids || []
      const targetTeamId = ctx?.target?.team_id ?? ctx?.inspection?.team_id
      return targetTeamId != null && includesAny([targetTeamId], actorTeamIds)
    },
    draftOrReopened: (ctx) => ["draft", "reopened"].includes(ctx?.inspection?.status),
    submittedOrInReviewOrReopened: (ctx) =>
      ["submitted", "in_review", "reopened"].includes(ctx?.inspection?.status),
    allowedInspectorUpdateFields: (ctx) => {
      const fields = ctx?.patchFields || []
      const allowed = ctx?.allowedInspectorFields || DEFAULT_ALLOWED_INSPECTOR_FIELDS
      const allowedSet = allowed instanceof Set ? allowed : new Set(allowed)
      return fields.every((field) => allowedSet.has(field))
    },
    allowedSelfProfileFields: (ctx) => {
      const fields = ctx?.patchFields || []
      const allowed = ctx?.allowedProfileFields || DEFAULT_ALLOWED_PROFILE_FIELDS
      const allowedSet = allowed instanceof Set ? allowed : new Set(allowed)
      return fields.every((field) => allowedSet.has(field))
    },
  }
}

function createDefaultScopes(conditions) {
  return {
    all: () => true,
    self: (ctx) => conditions.isSelf(ctx),
    member_of: (ctx) => conditions.teamMatch(ctx),
    assigned_or_created: (ctx) => conditions.isAssignee(ctx) || conditions.isCreator(ctx),
    team_scope: (ctx) => conditions.teamMatch(ctx),
    assigned_inspection: (ctx) => conditions.isAssignee(ctx),
    own_inspection: (ctx) => conditions.isAssignee(ctx) || conditions.isCreator(ctx),
    own_actions: (ctx) =>
      ctx?.actor?.id != null && ctx?.target?.user_id != null && ctx.actor.id === ctx.target.user_id,
  }
}

function getRule(rolePolicy, resource, action) {
  if (!rolePolicy) return null
  const resourcePolicy = rolePolicy[resource] || rolePolicy["*"]
  if (!resourcePolicy) return null
  return resourcePolicy[action] || null
}

function normalizeRoles(role) {
  if (Array.isArray(role)) return role.filter((value) => typeof value === "string" && value.trim())
  if (typeof role === "string" && role.trim()) return [role.trim()]
  return []
}

function isRuleAllowed(rule, ctx, options) {
  if (rule === true) return true
  if (!rule || typeof rule !== "object") return false

  const {
    conditions = createDefaultConditions(),
    scopes = createDefaultScopes(conditions),
    strictUnknownConditions = true,
    strictUnknownScopes = true,
  } = options || {}

  if (rule.scope) {
    const scopeCheck = scopes[rule.scope]
    if (!scopeCheck) return !strictUnknownScopes
    if (!scopeCheck(ctx)) return false
  }

  if (Array.isArray(rule.conditions)) {
    for (const conditionName of rule.conditions) {
      const conditionCheck = conditions[conditionName]
      if (!conditionCheck) {
        if (strictUnknownConditions) return false
        continue
      }
      if (!conditionCheck(ctx)) return false
    }
  }

  return true
}

export function can(role, action, resource, ctx = {}, options = {}) {
  const roles = normalizeRoles(role)
  const policy = options.policy || DEFAULT_POLICY

  const context = {
    ...ctx,
    actor: {
      ...(ctx.actor || {}),
      roles,
    },
  }

  return roles.some((singleRole) => {
    const rolePolicy = policy.roles?.[singleRole]
    const rule = getRule(rolePolicy, resource, action)
    return isRuleAllowed(rule, context, options)
  })
}

export function canTransition(role, fromStatus, toStatus, options = {}) {
  const roles = normalizeRoles(role)
  const policy = options.policy || DEFAULT_POLICY

  return roles.some((singleRole) => {
    const transitions = policy.statusTransitions?.[singleRole]
    if (!transitions) return false

    const allowed = transitions[fromStatus] || transitions["*"] || []
    return allowed.includes(toStatus)
  })
}

export function authorize(action, resource, options = {}) {
  const {
    policy = DEFAULT_POLICY,
    conditions,
    scopes,
    strictUnknownConditions = true,
    strictUnknownScopes = true,
    contextResolver = () => ({}),
    forbiddenStatus = 403,
    forbiddenBody = { error: "Forbidden" },
  } = options

  return (req, res, next) => {
    const actor = req.user || {}
    const roles = normalizeRoles(Array.isArray(actor.roles) ? actor.roles : actor.role)
    const context = {
      ...contextResolver(req),
      actor,
    }

    const allowed = can(roles, action, resource, context, {
      policy,
      conditions,
      scopes,
      strictUnknownConditions,
      strictUnknownScopes,
    })

    if (!allowed) {
      res.status(forbiddenStatus).json(forbiddenBody)
      return
    }

    next()
  }
}

export { DEFAULT_POLICY }
