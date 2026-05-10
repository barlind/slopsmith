// Slopsmith capability registry and dispatcher.
(function () {
    'use strict';

    window.slopsmith = window.slopsmith || {};
    if (window.slopsmith.capabilities && window.slopsmith.capabilities.version === 1) return;

    const VALID_ROLES = new Set([
        'owner', 'provider', 'observer', 'requester', 'transformer', 'handler',
        'validator', 'short-circuiter', 'contributor',
    ]);
    const VALID_MODES = new Set(['active', 'optional', 'legacy-shim', 'disabled']);
    const VALID_COMPATIBILITY = new Set(['none', 'shim-allowed', 'degrade-noop', 'required', 'legacy-window-shim']);
    const OUTCOMES = new Set(['passed', 'transformed', 'handled', 'denied', 'degraded', 'failed', 'short-circuited', 'overridden']);
    const MAX_DECISIONS = 100;
    const MAX_SNAPSHOT_BYTES = 64 * 1024;
    const DEFAULT_HANDLER_TIMEOUT_MS = 250;

    const pipelines = new Map();
    const recentDecisions = [];
    const missingProviders = [];
    const compatibilityShims = [];
    const userOverrides = [];
    const activeClaims = new Map();
    const subscribers = new Map();
    const knownPlugins = new Map();
    const uiContributions = new Map();
    let commandSeq = 0;
    let decisionSeq = 0;

    function _now() { return new Date().toISOString(); }

    function _asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function _uniqueStrings(value, allowed = null) {
        const out = [];
        const seen = new Set();
        for (const item of _asArray(value)) {
            if (typeof item !== 'string' || !item.trim()) continue;
            const normalized = item.trim();
            if (allowed && !allowed.has(normalized)) continue;
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            out.push(normalized);
        }
        return out;
    }

    function _order(order) {
        const source = order && typeof order === 'object' ? order : {};
        return {
            fixed: !!source.fixed,
            before: _uniqueStrings(source.before),
            after: _uniqueStrings(source.after),
        };
    }

    function _normalizeDeclaration(declaration) {
        const source = declaration && typeof declaration === 'object' ? declaration : {};
        const mode = VALID_MODES.has(source.mode) ? source.mode : 'active';
        const compatibility = VALID_COMPATIBILITY.has(source.compatibility)
            ? source.compatibility
            : 'degrade-noop';
        return {
            roles: _uniqueStrings(source.roles, VALID_ROLES),
            events: _uniqueStrings(source.events),
            commands: _uniqueStrings(source.commands),
            order: _order(source.order),
            mode,
            compatibility,
            handlers: source.handlers && typeof source.handlers === 'object' ? source.handlers : {},
            eventHandlers: source.eventHandlers && typeof source.eventHandlers === 'object' ? source.eventHandlers : {},
            runtime: !!source.runtime,
        };
    }

    function _capabilityMap(declaration) {
        if (!declaration || typeof declaration !== 'object') return {};
        if (declaration.capabilities && typeof declaration.capabilities === 'object') {
            return declaration.capabilities;
        }
        return declaration;
    }

    function _standardList(source) {
        if (!source || typeof source !== 'object' || !Array.isArray(source.standards)) return [];
        const result = [];
        const seen = new Set();
        for (const entry of source.standards) {
            if (typeof entry !== 'string' || !entry.trim()) continue;
            const standard = entry.trim();
            if (seen.has(standard)) continue;
            seen.add(standard);
            result.push(standard);
        }
        return result;
    }

    function _rememberPluginManifest(pluginId, declaration) {
        if (!pluginId || typeof pluginId !== 'string') return;
        const existing = knownPlugins.get(pluginId) || {
            pluginId,
            capabilities: new Set(),
            standards: new Set(),
            firstSeenAt: _now(),
            updatedAt: null,
        };
        for (const standard of _standardList(declaration)) {
            existing.standards.add(standard);
        }
        const caps = _capabilityMap(declaration && declaration.declaration ? declaration.declaration : declaration);
        for (const [capabilityName, rawDeclaration] of Object.entries(caps)) {
            if (!capabilityName || !rawDeclaration || typeof rawDeclaration !== 'object') continue;
            existing.capabilities.add(capabilityName);
        }
        existing.updatedAt = _now();
        knownPlugins.set(pluginId, existing);
    }

    function _pluginEntryId(entry) {
        if (!entry || typeof entry !== 'object') return '';
        return typeof entry.pluginId === 'string' ? entry.pluginId : (typeof entry.id === 'string' ? entry.id : '');
    }

    function _pluginEntryDeclaration(entry) {
        if (!entry || typeof entry !== 'object') return {};
        if (entry.declaration && typeof entry.declaration === 'object') return entry.declaration;
        if (entry.capabilities && typeof entry.capabilities === 'object') return entry.capabilities;
        return {};
    }

    function _pipeline(name) {
        if (!pipelines.has(name)) {
            pipelines.set(name, {
                name,
                participants: new Map(),
                order: [],
                conflicts: [],
                resolvedAt: null,
            });
        }
        return pipelines.get(name);
    }

    function _mergeParticipant(existing, incoming) {
        if (!existing) return incoming;
        const runtimeOverride = existing.runtimeOverride;
        const mergedDeclarationMode = incoming.declarationMode || existing.declarationMode;
        const mergedMode = runtimeOverride
            ? (runtimeOverride.enabled ? (mergedDeclarationMode !== 'disabled' ? mergedDeclarationMode : 'active') : 'disabled')
            : (incoming.mode || existing.mode);
        return {
            ...existing,
            roles: _uniqueStrings([...(existing.roles || []), ...(incoming.roles || [])], VALID_ROLES),
            events: _uniqueStrings([...(existing.events || []), ...(incoming.events || [])]),
            commands: _uniqueStrings([...(existing.commands || []), ...(incoming.commands || [])]),
            order: {
                fixed: !!(existing.order && existing.order.fixed) || !!(incoming.order && incoming.order.fixed),
                before: _uniqueStrings([...(existing.order?.before || []), ...(incoming.order?.before || [])]),
                after: _uniqueStrings([...(existing.order?.after || []), ...(incoming.order?.after || [])]),
            },
            mode: mergedMode,
            compatibility: incoming.compatibility || existing.compatibility,
            handlers: { ...(existing.handlers || {}), ...(incoming.handlers || {}) },
            eventHandlers: { ...(existing.eventHandlers || {}), ...(incoming.eventHandlers || {}) },
            runtime: !!existing.runtime || !!incoming.runtime,
            declarationMode: mergedDeclarationMode,
            runtimeOverride,
        };
    }

    function _missingOrderPeerConflict(capabilityName, participant, peer, relation) {
        const inactivePeer = _pipeline(capabilityName).participants.get(peer);
        if (inactivePeer && inactivePeer.mode === 'disabled') {
            return {
                type: 'disabled-order-peer',
                participant: participant.pluginId,
                peer,
                reason: `${relation} peer is registered but disabled`,
            };
        }
        const knownPeer = knownPlugins.get(peer);
        if (knownPeer && !(knownPeer.capabilities || new Set()).has(capabilityName)) {
            return {
                type: 'missing-capability-peer',
                participant: participant.pluginId,
                peer,
                reason: `${relation} peer is registered but does not declare capability ${capabilityName}`,
            };
        }
        return {
            type: 'missing-order-peer',
            participant: participant.pluginId,
            peer,
            reason: `${relation} peer is not registered`,
        };
    }

    function _participantPriority(participant) {
        if (participant.roles.includes('owner')) return 0;
        if (participant.roles.includes('provider')) return 1;
        if (participant.roles.includes('validator')) return 2;
        if (participant.roles.includes('transformer')) return 3;
        if (participant.roles.includes('handler')) return 4;
        if (participant.roles.includes('short-circuiter')) return 5;
        return 6;
    }

    function _resolvePipeline(name) {
        const pipeline = _pipeline(name);
        const participants = Array.from(pipeline.participants.values())
            .filter(p => p.mode !== 'disabled')
            .sort((a, b) => {
                const fixedDelta = Number(!!b.order.fixed) - Number(!!a.order.fixed);
                if (fixedDelta) return fixedDelta;
                const priorityDelta = _participantPriority(a) - _participantPriority(b);
                if (priorityDelta) return priorityDelta;
                return a.pluginId.localeCompare(b.pluginId);
            });

        const byId = new Map(participants.map(p => [p.pluginId, p]));
        const ids = participants.map(p => p.pluginId);
        const edges = new Map(ids.map(id => [id, new Set()]));
        const conflicts = [];

        for (const participant of participants) {
            for (const before of participant.order.before || []) {
                if (!byId.has(before)) {
                    conflicts.push(_missingOrderPeerConflict(name, participant, before, 'before'));
                    continue;
                }
                edges.get(participant.pluginId).add(before);
            }
            for (const after of participant.order.after || []) {
                if (!byId.has(after)) {
                    conflicts.push(_missingOrderPeerConflict(name, participant, after, 'after'));
                    continue;
                }
                edges.get(after).add(participant.pluginId);
            }
        }

        const owners = participants.filter(p => p.roles.includes('owner'));
        if (owners.length > 1) {
            conflicts.push({
                type: 'duplicate-owner',
                participants: owners.map(p => p.pluginId),
                reason: `Capability ${name} has multiple owners`,
            });
        }

        const indegree = new Map(ids.map(id => [id, 0]));
        for (const [, next] of edges) {
            for (const id of next) indegree.set(id, (indegree.get(id) || 0) + 1);
        }
        const baseOrder = new Map(ids.map((id, idx) => [id, idx]));
        const queue = ids.filter(id => indegree.get(id) === 0)
            .sort((a, b) => baseOrder.get(a) - baseOrder.get(b));
        const insertByBaseOrder = (id) => {
            const rank = baseOrder.get(id);
            let low = 0;
            let high = queue.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (baseOrder.get(queue[mid]) < rank) low = mid + 1;
                else high = mid;
            }
            queue.splice(low, 0, id);
        };
        const resolved = [];
        while (queue.length) {
            const id = queue.shift();
            resolved.push(id);
            for (const next of edges.get(id) || []) {
                indegree.set(next, indegree.get(next) - 1);
                if (indegree.get(next) === 0) {
                    insertByBaseOrder(next);
                }
            }
        }
        if (resolved.length !== ids.length) {
            conflicts.push({ type: 'order-cycle', reason: `Capability ${name} has incompatible ordering constraints` });
            pipeline.order = ids;
        } else {
            pipeline.order = resolved;
        }
        pipeline.conflicts = conflicts;
        pipeline.resolvedAt = _now();
        _emitEvent('diagnostics', 'pipeline.resolved', { capability: name, order: pipeline.order, conflicts });
        return pipeline;
    }

    function _participantSummary(participant) {
        return {
            pluginId: participant.pluginId,
            capability: participant.capability,
            roles: participant.roles.slice(),
            events: participant.events.slice(),
            commands: participant.commands.slice(),
            order: {
                fixed: !!participant.order.fixed,
                before: participant.order.before.slice(),
                after: participant.order.after.slice(),
            },
            mode: participant.mode,
            declarationMode: participant.declarationMode || participant.mode,
            enabled: participant.mode !== 'disabled',
            compatibility: participant.compatibility,
            runtime: !!participant.runtime,
            runtimeOverride: participant.runtimeOverride || null,
        };
    }

    function _pipelineParticipants(pipeline) {
        const ordered = [];
        const seen = new Set();
        for (const id of pipeline.order) {
            const participant = pipeline.participants.get(id);
            if (!participant) continue;
            ordered.push(participant);
            seen.add(id);
        }
        const remaining = Array.from(pipeline.participants.values())
            .filter(participant => !seen.has(participant.pluginId))
            .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
        return [...ordered, ...remaining];
    }

    function _pipelineSummary(pipeline) {
        return {
            name: pipeline.name,
            order: pipeline.order.slice(),
            resolvedAt: pipeline.resolvedAt,
            conflicts: pipeline.conflicts.slice(),
            participants: _pipelineParticipants(pipeline).map(_participantSummary),
        };
    }

    function _knownPluginSummary(plugin) {
        return {
            pluginId: plugin.pluginId,
            standards: Array.from(plugin.standards || []).sort(),
            capabilities: Array.from(plugin.capabilities || []).sort(),
            firstSeenAt: plugin.firstSeenAt,
            updatedAt: plugin.updatedAt,
        };
    }

    function _redactString(value) {
        return String(value)
            .replace(/\/Users\/[^\s/]+(?:\/[^\s]*)?/g, '[path]')
            .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
            .replace(/\b(token|secret|password|api[_-]?key)=([^\s&]+)/gi, '$1=[redacted]');
    }

    function _safeValue(value, depth = 0) {
        if (typeof value === 'string') return _redactString(value);
        if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (depth > 8) return '[truncated]';
        if (Array.isArray(value)) return value.slice(0, 50).map(item => _safeValue(item, depth + 1));
        if (typeof value === 'object') {
            const out = {};
            for (const [key, item] of Object.entries(value).slice(0, 50)) {
                out[_redactString(key)] = _safeValue(item, depth + 1);
            }
            return out;
        }
        return String(value);
    }

    function _recordDecision(decision) {
        recentDecisions.push({ decisionId: `decision-${++decisionSeq}`, timestamp: _now(), ...decision });
        while (recentDecisions.length > MAX_DECISIONS) recentDecisions.shift();
        _contributeDiagnostics();
    }

    function _remember(list, entry, max = 50) {
        list.push({ timestamp: _now(), ...entry });
        while (list.length > max) list.shift();
        _contributeDiagnostics();
    }

    function _claimKey(capability, claimId) {
        return `${capability || 'unknown'}:${claimId || 'unknown'}`;
    }

    function _targetSelector(source = {}) {
        const payload = source.payload && typeof source.payload === 'object' ? source.payload : source.args || source;
        const target = payload.target && typeof payload.target === 'object' ? payload.target : source.target || {};
        const value = payload.selector || target.selector || target.id || target.kind || source.selector || '*';
        return String(value || '*').toLowerCase();
    }

    function _claimFromContext(ctx) {
        const payload = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
        const claim = ctx.claim && typeof ctx.claim === 'object' ? ctx.claim : (payload.claim && typeof payload.claim === 'object' ? payload.claim : {});
        const claimId = claim.claimId || payload.claimId;
        if (!claimId) return null;
        const capability = claim.capability || ctx.capability;
        return activeClaims.get(_claimKey(capability, claimId)) || {
            claimId,
            capability,
            owner: claim.owner || ctx.requester || 'unknown',
            createdAt: ctx.timestamp || _now(),
            synthetic: true,
        };
    }

    function _overrideMatchesClaim(ctx, claim) {
        const selector = _targetSelector(ctx);
        const createdAt = Date.parse(claim.createdAt || '') || 0;
        return userOverrides.some(entry => {
            if (entry.capability !== claim.capability) return false;
            if ((Date.parse(entry.timestamp || '') || 0) < createdAt) return false;
            const entrySelector = _targetSelector(entry);
            return selector === '*' || entrySelector === '*' || selector === entrySelector;
        });
    }

    function _notifySubscribers(event, detail) {
        for (const key of [event, '*']) {
            const handlers = subscribers.get(key) || [];
            for (const handler of handlers.slice()) {
                try { handler(detail); }
                catch (err) { console.warn('[capabilities] subscriber failed:', err); }
            }
        }
    }

    function _withTimeout(promise, timeoutMs, participant) {
        return Promise.race([
            promise,
            new Promise(resolve => {
                setTimeout(() => resolve({
                    outcome: 'failed',
                    reason: `Handler ${participant.pluginId} timed out after ${timeoutMs} ms`,
                }), timeoutMs);
            }),
        ]);
    }

    function _normalizeDecision(participant, result) {
        const source = result && typeof result === 'object' ? result : { outcome: result ? 'handled' : 'passed' };
        const outcome = OUTCOMES.has(source.outcome) ? source.outcome : 'handled';
        const decision = {
            participant: participant.pluginId,
            outcome,
            reason: typeof source.reason === 'string' ? source.reason : undefined,
            payload: source.payload,
        };
        if (['denied', 'degraded', 'failed', 'short-circuited', 'overridden'].includes(decision.outcome) && !decision.reason) {
            decision.reason = `${participant.pluginId} returned ${decision.outcome}`;
        }
        return decision;
    }

    function _finalOutcome(decisions) {
        if (!decisions.length) return 'degraded';
        const terminal = decisions.find(d => ['denied', 'failed', 'short-circuited', 'handled', 'degraded', 'overridden'].includes(d.outcome));
        return terminal ? terminal.outcome : decisions[decisions.length - 1].outcome;
    }

    function _blockingConflict(conflicts) {
        return conflicts.find(conflict => conflict.type === 'duplicate-owner' || conflict.type === 'order-cycle') || null;
    }

    function _emitEvent(capability, event, payload) {
        const detail = { capability, event, payload: payload || {}, timestamp: _now() };
        _notifySubscribers(event, detail);
        _notifySubscribers(`${capability}:${event}`, detail);
        try {
            if (window.slopsmith && typeof window.slopsmith.emit === 'function') {
                window.slopsmith.emit(`${capability}:${event}`, detail);
                window.slopsmith.emit('capability:event', detail);
            } else {
                window.dispatchEvent(new CustomEvent(`${capability}:${event}`, { detail }));
                window.dispatchEvent(new CustomEvent('slopsmith:capability:event', { detail }));
            }
        } catch (err) {
            console.warn('[capabilities] event dispatch failed:', err);
        }
        const pipeline = pipelines.get(capability);
        if (!pipeline) return;
        for (const participant of pipeline.participants.values()) {
            const handler = participant.eventHandlers && participant.eventHandlers[event];
            if (typeof handler !== 'function') continue;
            try { handler(detail); }
            catch (err) {
                _recordDecision({
                    commandId: `event-${capability}-${event}`,
                    capability,
                    command: event,
                    requester: detail.payload.source || 'event',
                    participant: participant.pluginId,
                    outcome: 'failed',
                    reason: err && err.message ? err.message : String(err),
                });
            }
        }
    }

    async function command(capabilityName, commandName, context = {}) {
        const commandId = `command-${++commandSeq}`;
        const pipeline = _resolvePipeline(capabilityName);
        const commandContext = {
            ...context,
            capability: capabilityName,
            command: commandName,
            requester: context.requester || 'unknown',
            origin: context.origin || 'system',
            reason: context.reason || 'No reason provided',
        };
        const decisions = [];
        const blockingConflict = _blockingConflict(pipeline.conflicts || []);
        if (blockingConflict) {
            const reason = `Capability ${capabilityName}.${commandName} degraded because ${blockingConflict.reason || blockingConflict.type}`;
            const decision = { participant: 'core', outcome: 'degraded', reason };
            decisions.push(decision);
            _recordDecision({
                commandId,
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                origin: commandContext.origin,
                target: commandContext.target,
                participant: 'core',
                outcome: 'degraded',
                reason,
            });
            return {
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                outcome: 'degraded',
                reason,
                decisions,
            };
        }
        const claim = _claimFromContext(commandContext);
        if (claim && _overrideMatchesClaim(commandContext, claim)) {
            const reason = `Capability ${capabilityName}.${commandName} skipped because a user override beat claim ${claim.claimId}`;
            const decision = { participant: 'core', outcome: 'overridden', reason, payload: { claimId: claim.claimId } };
            decisions.push(decision);
            _recordDecision({
                commandId,
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                origin: commandContext.origin,
                target: commandContext.target,
                participant: 'core',
                outcome: 'overridden',
                reason,
                claimId: claim.claimId,
            });
            _emitEvent(capabilityName, 'override', { command: commandName, requester: commandContext.requester, claimId: claim.claimId, target: commandContext.target || commandContext.payload?.target || null });
            return {
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                outcome: 'overridden',
                reason,
                payload: decision.payload,
                decisions,
            };
        }
        for (const participantId of pipeline.order) {
            const participant = pipeline.participants.get(participantId);
            if (!participant || participant.mode === 'disabled') continue;
            const handler = participant.handlers && participant.handlers[commandName];
            if (typeof handler !== 'function') continue;
            let decision;
            try {
                const timeoutMs = Number(commandContext.timeoutMs || DEFAULT_HANDLER_TIMEOUT_MS);
                const result = await _withTimeout(Promise.resolve(handler(commandContext)), timeoutMs, participant);
                decision = _normalizeDecision(participant, result);
            } catch (err) {
                decision = {
                    participant: participant.pluginId,
                    outcome: 'failed',
                    reason: err && err.message ? err.message : String(err),
                };
            }
            decisions.push(decision);
            _recordDecision({
                commandId,
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                origin: commandContext.origin,
                target: commandContext.target,
                participant: decision.participant,
                outcome: decision.outcome,
                reason: decision.reason,
            });
            if (decision.outcome === 'transformed' && decision.payload && typeof decision.payload === 'object') {
                commandContext.payload = decision.payload;
                continue;
            }
            if (['denied', 'failed', 'short-circuited', 'handled', 'degraded'].includes(decision.outcome)) break;
        }
        if (!decisions.length) {
            const reason = `No provider handled ${capabilityName}.${commandName}`;
            _remember(missingProviders, { capability: capabilityName, command: commandName, requester: commandContext.requester, reason });
            const decision = { participant: 'core', outcome: 'degraded', reason };
            decisions.push(decision);
            _recordDecision({
                commandId,
                capability: capabilityName,
                command: commandName,
                requester: commandContext.requester,
                origin: commandContext.origin,
                participant: 'core',
                outcome: 'degraded',
                reason,
            });
        }
        const outcome = _finalOutcome(decisions);
        const terminalDecision = decisions.find(d => ['denied', 'failed', 'short-circuited', 'handled', 'degraded', 'overridden'].includes(d.outcome))
            || decisions[decisions.length - 1];
        return {
            capability: capabilityName,
            command: commandName,
            requester: commandContext.requester,
            outcome,
            reason: decisions.find(d => d.reason)?.reason,
            payload: terminalDecision && terminalDecision.payload,
            decisions,
        };
    }

    function _registerParticipant(pluginId, declaration, options = {}) {
        if (!pluginId || typeof pluginId !== 'string') return;
        _rememberPluginManifest(pluginId, declaration);
        const caps = _capabilityMap(declaration);
        const touched = new Set();
        for (const [capabilityName, rawDeclaration] of Object.entries(caps)) {
            if (!capabilityName || !rawDeclaration || typeof rawDeclaration !== 'object') continue;
            const normalized = _normalizeDeclaration(rawDeclaration);
            const pipeline = _pipeline(capabilityName);
            const participant = {
                pluginId,
                capability: capabilityName,
                ...normalized,
                declarationMode: normalized.mode,
            };
            pipeline.participants.set(pluginId, _mergeParticipant(pipeline.participants.get(pluginId), participant));
            touched.add(capabilityName);
            if (!options.deferResolve) _resolvePipeline(capabilityName);
            _notifySubscribers('registered', { capability: capabilityName, pluginId, timestamp: _now() });
        }
        return touched;
    }

    function registerParticipant(pluginId, declaration) {
        _registerParticipant(pluginId, declaration);
        _contributeDiagnostics();
    }

    function setParticipantEnabled(pluginId, capabilityName, enabled, options = {}) {
        if (!pluginId || typeof pluginId !== 'string' || !capabilityName || typeof capabilityName !== 'string') {
            return { ok: false, reason: 'pluginId and capabilityName are required' };
        }
        if (pluginId === 'core') {
            return { ok: false, reason: 'Core capability participants cannot be disabled at runtime' };
        }
        const pipeline = pipelines.get(capabilityName);
        const participant = pipeline && pipeline.participants.get(pluginId);
        if (!participant) {
            return { ok: false, reason: `${pluginId} is not registered for ${capabilityName}` };
        }
        const nextEnabled = !!enabled;
        const previousMode = participant.mode;
        const restoredMode = participant.declarationMode && participant.declarationMode !== 'disabled'
            ? participant.declarationMode
            : 'active';
        participant.mode = nextEnabled ? restoredMode : 'disabled';
        participant.runtimeOverride = {
            enabled: nextEnabled,
            requester: options.requester || 'runtime',
            reason: options.reason || (nextEnabled ? 'Runtime capability enabled' : 'Runtime capability disabled'),
            timestamp: _now(),
        };
        const overrideEntry = {
            capability: capabilityName,
            source: participant.runtimeOverride.requester,
            target: pluginId,
            reason: participant.runtimeOverride.reason,
        };
        const resolved = _resolvePipeline(capabilityName);
        _remember(userOverrides, {
            ...overrideEntry,
        });
        _emitEvent('diagnostics', 'participant.state-changed', {
            capability: capabilityName,
            pluginId,
            enabled: nextEnabled,
            previousMode,
            mode: participant.mode,
            conflicts: resolved.conflicts.slice(),
        });
        _contributeDiagnostics();
        return {
            ok: true,
            capability: capabilityName,
            pluginId,
            enabled: nextEnabled,
            previousMode,
            mode: participant.mode,
            conflicts: resolved.conflicts.slice(),
        };
    }

    function registerParticipants(entries) {
        const touched = new Set();
        const list = Array.isArray(entries) ? entries : [];
        for (const entry of list) {
            const pluginId = _pluginEntryId(entry);
            if (!pluginId) continue;
            _rememberPluginManifest(pluginId, entry);
        }
        for (const entry of list) {
            const pluginId = _pluginEntryId(entry);
            if (!pluginId) continue;
            const participantCaps = _registerParticipant(pluginId, _pluginEntryDeclaration(entry), { deferResolve: true });
            for (const capabilityName of participantCaps || []) touched.add(capabilityName);
        }
        for (const capabilityName of Array.from(touched).sort()) _resolvePipeline(capabilityName);
        _contributeDiagnostics();
        return Array.from(touched).sort();
    }

    function unregisterParticipant(pluginId, capabilityName = null) {
        for (const [name, pipeline] of pipelines.entries()) {
            if (capabilityName && name !== capabilityName) continue;
            if (pipeline.participants.delete(pluginId)) {
                _resolvePipeline(name);
                _notifySubscribers('unregistered', { capability: name, pluginId, timestamp: _now() });
            }
        }
        _contributeDiagnostics();
    }

    function inspect(capabilityName = null) {
        if (capabilityName) {
            const pipeline = pipelines.get(capabilityName);
            return pipeline ? _pipelineSummary(pipeline) : null;
        }
        return Array.from(pipelines.values()).map(_pipelineSummary);
    }

    function validateRuntime(options = {}) {
        const phase = options && typeof options.phase === 'string' ? options.phase : 'runtime';
        for (const capabilityName of Array.from(pipelines.keys()).sort()) _resolvePipeline(capabilityName);
        const snapshot = snapshotDiagnostics();
        _emitEvent('diagnostics', 'runtime.validated', {
            phase,
            conflicts: snapshot.conflicts || [],
            pipelineCount: (snapshot.pipelines || []).length,
            participantCount: (snapshot.participants || []).length,
        });
        _contributeDiagnostics();
        return snapshot;
    }

    function registerCompatibilityShim(shim) {
        const source = shim && typeof shim === 'object' ? shim : {};
        _remember(compatibilityShims, {
            shimId: source.shimId || `${source.capability || 'unknown'}:${source.legacySurface || 'legacy'}`,
            source: source.source || 'unknown',
            capability: source.capability || 'unknown',
            legacySurface: source.legacySurface || 'unknown',
            status: source.status || 'active',
            reason: source.reason,
        });
    }

    function recordUserOverride(override) {
        const source = override && typeof override === 'object' ? override : {};
        _remember(userOverrides, {
            capability: source.capability || 'unknown',
            command: source.command,
            source: source.source || 'unknown',
            target: source.target,
            selector: source.selector || _targetSelector(source),
            reason: source.reason || 'User override recorded',
        });
    }

    function claim(request = {}) {
        const source = request && typeof request === 'object' ? request : {};
        const capability = source.capability || 'unknown';
        const claimId = source.claimId || source.id;
        if (!claimId) return () => {};
        const key = _claimKey(capability, claimId);
        if (!activeClaims.has(key)) {
            const entry = {
                claimId,
                capability,
                owner: source.owner || source.requester || 'unknown',
                createdAt: _now(),
                reason: source.reason,
            };
            activeClaims.set(key, entry);
            _recordDecision({ commandId: `claim-${claimId}`, capability, command: 'claim', requester: entry.owner, participant: 'core', outcome: 'handled', reason: entry.reason });
            _emitEvent(capability, 'claim:created', entry);
        }
        return () => release({ capability, claimId });
    }

    function release(request = {}) {
        const source = typeof request === 'string' ? { claimId: request } : (request && typeof request === 'object' ? request : {});
        const claimId = source.claimId || source.id;
        if (!claimId) return { ok: true, released: false };
        let released = null;
        for (const [key, entry] of Array.from(activeClaims.entries())) {
            if (entry.claimId !== claimId) continue;
            if (source.capability && entry.capability !== source.capability) continue;
            activeClaims.delete(key);
            released = entry;
            _emitEvent(entry.capability, 'claim:released', entry);
        }
        if (!released) {
            _recordDecision({ commandId: `release-${claimId}`, capability: source.capability || 'unknown', command: 'release', requester: source.owner || source.requester || 'unknown', participant: 'core', outcome: 'degraded', reason: 'Release requested for unknown claim' });
            return { ok: true, released: false };
        }
        _recordDecision({ commandId: `release-${claimId}`, capability: released.capability, command: 'release', requester: source.owner || source.requester || released.owner, participant: 'core', outcome: 'handled' });
        return { ok: true, released: true, claim: released };
    }

    function _dispatchStatus(result) {
        if (!result) return 'error';
        if (result.status) return result.status;
        if (result.outcome === 'handled' || result.outcome === 'passed') return 'applied';
        if (result.outcome === 'overridden') return 'overridden';
        if (result.outcome === 'denied' || result.outcome === 'short-circuited') return 'blocked';
        if (result.outcome === 'failed') return 'error';
        if (result.outcome === 'degraded') return 'no-handler';
        return result.outcome || 'error';
    }

    async function dispatch(request = {}) {
        const source = request && typeof request === 'object' ? request : {};
        const capability = source.capability;
        const commandName = source.command;
        if (!capability || !commandName) return { status: 'error', outcome: 'failed', reason: 'capability and command are required' };
        const pipeline = _resolvePipeline(capability);
        const participants = _pipelineParticipants(pipeline).filter(participant => participant.mode !== 'disabled');
        const owners = participants.filter(participant => participant.roles.includes('owner'));
        if (!owners.length) {
            const reason = `No owner registered for ${capability}`;
            _remember(missingProviders, { capability, command: commandName, requester: source.source || source.requester || 'dispatch', reason });
            _recordDecision({ commandId: `dispatch-${++commandSeq}`, capability, command: commandName, requester: source.source || source.requester || 'dispatch', participant: 'core', outcome: 'degraded', reason });
            _emitEvent(capability, 'conflict:missing-provider', { command: commandName, reason });
            return { status: 'no-owner', outcome: 'degraded', capability, command: commandName, reason };
        }
        const hasHandler = participants.some(participant => participant.handlers && typeof participant.handlers[commandName] === 'function');
        if (!hasHandler) {
            const reason = `No handler registered for ${capability}.${commandName}`;
            _remember(missingProviders, { capability, command: commandName, requester: source.source || source.requester || 'dispatch', reason });
            _recordDecision({ commandId: `dispatch-${++commandSeq}`, capability, command: commandName, requester: source.source || source.requester || 'dispatch', participant: 'core', outcome: 'degraded', reason });
            return { status: 'no-handler', outcome: 'degraded', capability, command: commandName, reason };
        }
        const result = await command(capability, commandName, {
            requester: source.source || source.requester || 'dispatch',
            origin: source.origin || 'dispatch',
            reason: source.reason || 'Capability dispatch',
            target: source.target || source.args?.target || null,
            payload: source.args || source.payload || {},
            claim: source.claim,
        });
        const status = _dispatchStatus(result);
        _emitEvent(capability, 'dispatched', { command: commandName, status, result, source: source.source || source.requester || 'dispatch' });
        return { ...result, status };
    }

    function subscribe(event, fn) {
        if (typeof event !== 'string' || typeof fn !== 'function') return () => {};
        const handlers = subscribers.get(event) || [];
        handlers.push(fn);
        subscribers.set(event, handlers);
        return () => {
            const current = subscribers.get(event) || [];
            subscribers.set(event, current.filter(handler => handler !== fn));
        };
    }

    function snapshotDiagnostics() {
        const snapshot = {
            schema: 'slopsmith.capabilities.diagnostics.v1',
            pipelines: inspect(),
            participants: Array.from(pipelines.values()).flatMap(p => Array.from(p.participants.values()).map(_participantSummary)),
            recentDecisions: recentDecisions.slice(),
            conflicts: Array.from(pipelines.values()).flatMap(p => p.conflicts.map(c => ({ capability: p.name, ...c }))),
            missingProviders: missingProviders.slice(),
            compatibilityShims: compatibilityShims.slice(),
            userOverrides: userOverrides.slice(),
            activeClaims: Array.from(activeClaims.values()),
            knownPlugins: Array.from(knownPlugins.values()).map(_knownPluginSummary),
        };
        let currentSize = JSON.stringify(snapshot).length;
        while (snapshot.recentDecisions.length && currentSize > MAX_SNAPSHOT_BYTES) {
            const removedDecision = snapshot.recentDecisions.shift();
            currentSize -= JSON.stringify(removedDecision).length;
        }
        return _safeValue(snapshot);
    }

    let contributing = false;
    function _contributeDiagnostics() {
        if (contributing) return;
        const diagnostics = window.slopsmith && window.slopsmith.diagnostics;
        if (!diagnostics || typeof diagnostics.contribute !== 'function') return;
        contributing = true;
        try { diagnostics.contribute('capabilities', snapshotDiagnostics()); }
        catch (_err) { /* diagnostics must never break plugin behavior */ }
        finally { contributing = false; }
    }

    function _coreHandled(payload = {}) {
        return { outcome: 'handled', payload };
    }

    function _coreDegraded(reason, payload = {}) {
        return { outcome: 'degraded', reason, payload };
    }

    function _rememberContribution(list, ctx) {
        list.push({ requester: ctx.requester, payload: ctx.payload || {}, timestamp: _now() });
        return _coreHandled({ contributions: list.slice() });
    }

    function _rememberCoreDomainCommand(domainName, ctx) {
        const entries = coreDomainCommands.get(domainName) || [];
        entries.push({ command: ctx.command, requester: ctx.requester, target: ctx.target || null, payload: ctx.payload || {}, timestamp: _now() });
        coreDomainCommands.set(domainName, entries.slice(-50));
        return _coreHandled({ recent: coreDomainCommands.get(domainName) || [] });
    }

    function _inspectCoreDomain(domainName) {
        return _coreHandled({ recent: coreDomainCommands.get(domainName) || [] });
    }

    function _uiContributionList(domainName) {
        return uiContributions.get(domainName) || [];
    }

    function _uiContributionKey(ctx) {
        const target = ctx.target && typeof ctx.target === 'object' ? ctx.target : {};
        const payload = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
        return String(target.id || payload.id || payload.contribution_id || ctx.requester || 'unknown');
    }

    function _rememberUiContributionCommand(domainName, commandName, ctx) {
        const result = _rememberCoreDomainCommand(domainName, ctx);
        if (commandName === 'inspect') {
            return _coreHandled({ contributions: _uiContributionList(domainName), recent: coreDomainCommands.get(domainName) || [] });
        }
        const now = _now();
        const key = _uiContributionKey(ctx);
        const payload = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
        const target = ctx.target && typeof ctx.target === 'object' ? ctx.target : {};
        const existing = _uiContributionList(domainName).filter(item => item.id !== key);
        if (commandName !== 'unmount') {
            existing.push({
                id: key,
                pluginId: payload.pluginId || payload.plugin_id || target.pluginId || target.plugin_id || ctx.requester,
                region: payload.region || target.region || domainName,
                label: payload.label || target.label || key,
                order: payload.order || target.order || {},
                visible: commandName === 'set-visible' ? payload.visible !== false : payload.visible !== false,
                mounted: commandName === 'mount' || payload.mounted === true,
                updatedAt: now,
            });
        }
        uiContributions.set(domainName, existing.sort((a, b) => {
            const regionDelta = String(a.region || '').localeCompare(String(b.region || ''));
            if (regionDelta) return regionDelta;
            return String(a.id || '').localeCompare(String(b.id || ''));
        }));
        return result;
    }

    function _profileCommandEvent(commandName, ctx) {
        if (commandName === 'preview') return 'profile.previewed';
        if (['apply', 'partial-apply', 'stop-and-apply'].includes(commandName)) return 'profile.applied';
        if (commandName === 'queue-until-idle') return 'profile.queued';
        if (commandName === 'restore') return 'profile.restored';
        if (commandName === 'import') return 'profile.imported';
        if (commandName === 'export') return 'profile.exported';
        if (commandName === 'save-drift-as-profile') return 'profile.drift-detected';
        if (commandName === 'validate') {
            const validation = ctx.payload && (ctx.payload.validation || ctx.payload);
            if (validation && validation.status && validation.status !== 'valid') return 'profile.validation-failed';
        }
        return '';
    }

    function _sourceCommandEvent(commandName, ctx) {
        if (commandName === 'add') return 'source.added';
        if (commandName === 'refresh') return 'source.refreshed';
        if (commandName === 'update') return 'source.updated';
        if (commandName === 'trust') return 'source.trusted';
        if (commandName === 'untrust') return 'source.untrusted';
        if (commandName === 'remove') return 'source.removed';
        if (commandName === 'validate') {
            const validation = ctx.payload && (ctx.payload.validation || ctx.payload);
            if (validation && validation.status && validation.status !== 'valid') return 'source.validation-failed';
        }
        return '';
    }

    function _settingsPackCommandEvent(commandName, ctx) {
        if (commandName === 'preview') return 'pack.previewed';
        if (commandName === 'apply') return 'pack.applied';
        if (commandName === 'import') return 'pack.imported';
        if (commandName === 'export-current') return 'pack.exported';
        if (commandName === 'remove') return 'pack.removed';
        if (commandName === 'validate') {
            const validation = ctx.payload && (ctx.payload.validation || ctx.payload);
            if (validation && validation.status && validation.status !== 'valid') return 'pack.validation-failed';
        }
        return '';
    }

    function _rememberProfileCommand(commandName, ctx) {
        const result = _rememberCoreDomainCommand('profiles', ctx);
        const event = _profileCommandEvent(commandName, ctx);
        if (event) _emitEvent('profiles', event, { command: commandName, requester: ctx.requester, target: ctx.target || null, payload: ctx.payload || {} });
        if (ctx.payload && Array.isArray(ctx.payload.transition_blockers)) {
            _emitEvent('profiles', 'profile.blocker-changed', { command: commandName, requester: ctx.requester, target: ctx.target || null, blockers: ctx.payload.transition_blockers });
        }
        const targetItemId = ctx.target && (ctx.target.item_id || ctx.target.id);
        if (typeof targetItemId === 'string' && targetItemId.includes('support')) {
            _emitEvent('profiles', 'profile.support-diagnostics', { command: commandName, requester: ctx.requester, target: ctx.target || null });
        }
        return result;
    }

    function _rememberSourceCommand(commandName, ctx) {
        const result = _rememberCoreDomainCommand('configuration-sources', ctx);
        const event = _sourceCommandEvent(commandName, ctx);
        if (event) _emitEvent('configuration-sources', event, { command: commandName, requester: ctx.requester, target: ctx.target || null, payload: ctx.payload || {} });
        return result;
    }

    function _rememberSettingsPackCommand(commandName, ctx) {
        const result = _rememberCoreDomainCommand('settings-packs', ctx);
        const event = _settingsPackCommandEvent(commandName, ctx);
        if (event) _emitEvent('settings-packs', event, { command: commandName, requester: ctx.requester, target: ctx.target || null, payload: ctx.payload || {} });
        return result;
    }

    function _highwayApi() {
        return window.highway && typeof window.highway === 'object' ? window.highway : null;
    }

    function _audioElement() {
        const highway = _highwayApi();
        if (highway && typeof highway.getAudioElement === 'function') {
            try {
                const element = highway.getAudioElement();
                if (element) return element;
            } catch (_) {}
        }
        if (typeof document === 'undefined' || !document.getElementById) return null;
        return document.getElementById('audio');
    }

    function _perfNow() {
        return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    }

    function _chartTime(fallback = 0) {
        const highway = _highwayApi();
        if (highway && typeof highway.getTime === 'function') {
            try {
                const chartT = Number(highway.getTime());
                if (Number.isFinite(chartT)) return chartT;
            } catch (_) {}
        }
        return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
    }

    function _loopSnapshot() {
        const slopsmith = window.slopsmith;
        if (slopsmith && typeof slopsmith.getLoop === 'function') {
            try {
                const loop = slopsmith.getLoop() || {};
                const loopA = Number(loop.loopA);
                const loopB = Number(loop.loopB);
                return {
                    loopA: Number.isFinite(loopA) ? loopA : null,
                    loopB: Number.isFinite(loopB) ? loopB : null,
                };
            } catch (_) {}
        }
        return { loopA: null, loopB: null };
    }

    function _playbackDriver() {
        if (window.jucePlayer && typeof window.jucePlayer === 'object') return { kind: 'juce', target: window.jucePlayer };
        const audio = _audioElement();
        return audio ? { kind: 'html-audio', target: audio } : null;
    }

    function _playbackSnapshot() {
        const driver = _playbackDriver();
        if (!driver) return { available: false, source: null, currentTime: 0, audioT: 0, chartT: _chartTime(0), perfNow: _perfNow(), duration: 0, paused: true, loop: _loopSnapshot() };
        const target = driver.target;
        const audioT = Number(target.currentTime || 0);
        return {
            available: true,
            source: driver.kind,
            currentTime: audioT,
            audioT,
            chartT: _chartTime(audioT),
            perfNow: _perfNow(),
            duration: Number(target.duration || 0),
            paused: typeof target.paused === 'boolean' ? target.paused : !target._polling,
            loop: _loopSnapshot(),
        };
    }

    function _playbackAudioElementCommand() {
        const element = _audioElement();
        if (!element) return _coreDegraded('No playback audio element available', { available: false, element: null });
        return _coreHandled({ available: true, element, elementId: element.id || 'audio' });
    }

    async function _playbackLoopCommand(action, ctx = {}) {
        const slopsmith = window.slopsmith;
        if (action === 'loop-get') return _coreHandled(_playbackSnapshot());
        if (!slopsmith) return _coreDegraded('window.slopsmith is unavailable', _playbackSnapshot());
        if (action === 'loop-clear') {
            if (typeof slopsmith.clearLoop !== 'function') return _coreDegraded('Playback loop clear API is unavailable', _playbackSnapshot());
            slopsmith.clearLoop();
            return _coreHandled(_playbackSnapshot());
        }
        if (action === 'loop-set') {
            if (typeof slopsmith.setLoop !== 'function') return _coreDegraded('Playback loop set API is unavailable', _playbackSnapshot());
            const payload = ctx.payload || {};
            const target = ctx.target && typeof ctx.target === 'object' ? ctx.target : {};
            const a = payload.a ?? payload.loopA ?? payload.start ?? target.a ?? target.loopA ?? target.start;
            const b = payload.b ?? payload.loopB ?? payload.end ?? target.b ?? target.loopB ?? target.end;
            const ok = await slopsmith.setLoop(a, b);
            if (ok === false) return _coreDegraded('Playback loop set did not land on the requested start', _playbackSnapshot());
            return _coreHandled(_playbackSnapshot());
        }
        return _coreDegraded(`Unsupported playback loop command: ${action}`, _playbackSnapshot());
    }

    async function _playbackCommand(action, ctx = {}) {
        const driver = _playbackDriver();
        if (!driver) return _coreDegraded('No playback driver available', _playbackSnapshot());
        const target = driver.target;
        const payload = ctx.payload || {};
        if (action === 'play' && typeof target.play === 'function') await target.play();
        else if (action === 'pause' && typeof target.pause === 'function') await target.pause();
        else if (action === 'stop') {
            if (typeof target.stop === 'function') await target.stop();
            else if (typeof target.pause === 'function') {
                await target.pause();
                try { target.currentTime = 0; } catch (_) {}
            } else return _coreDegraded('Playback driver cannot stop', _playbackSnapshot());
        } else if (action === 'seek') {
            const seconds = Number(payload.seconds ?? payload.time ?? ctx.target);
            if (!Number.isFinite(seconds)) return _coreDegraded('Playback seek requires a numeric seconds value', _playbackSnapshot());
            if (window.slopsmith && typeof window.slopsmith.seek === 'function') {
                await window.slopsmith.seek(seconds, payload.reason || ctx.reason || 'capability-command');
            } else if (typeof target.seek === 'function') await target.seek(seconds);
            else {
                try { target.currentTime = Math.max(0, seconds); }
                catch (_) { return _coreDegraded('Playback driver cannot seek', _playbackSnapshot()); }
            }
        }
        return _coreHandled(_playbackSnapshot());
    }

    function _storageGet(key) {
        try { return window.localStorage && window.localStorage.getItem(key); }
        catch (_) { return null; }
    }

    function _storageSet(key, value) {
        try { if (window.localStorage) window.localStorage.setItem(key, value); }
        catch (_) {}
    }

    function _visualizationSelection() {
        const picker = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('viz-picker') : null;
        return (picker && picker.value) || visualizationCurrent || _storageGet('vizSelection') || null;
    }

    function _visualizationSnapshot() {
        return {
            current: _visualizationSelection(),
            providers: visualizationProviders.slice(),
        };
    }

    function _setVisualization(ctx = {}) {
        const payload = ctx.payload || {};
        const target = ctx.target && typeof ctx.target === 'object' ? ctx.target : {};
        const id = target.providerId || target.id || payload.providerId || payload.id || (typeof ctx.target === 'string' ? ctx.target : '');
        if (!id) return _coreDegraded('Visualization selection requires a provider id', _visualizationSnapshot());
        visualizationCurrent = id;
        _storageSet('vizSelection', id);
        const picker = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('viz-picker') : null;
        if (picker) picker.value = id;
        if (typeof window.setViz === 'function') window.setViz(id);
        return _coreHandled(_visualizationSnapshot());
    }

    const uiControlContributions = [];
    const uiPanelContributions = [];
    const uiNavigationContributions = [];
    const uiScreenContributions = [];
    const uiOverlayContributions = [];
    const settingsContributions = [];
    const audioMixParticipants = [];
    const audioMonitoring = new Map();
    const visualizationProviders = [];
    const coreDomainCommands = new Map();
    let visualizationCurrent = null;

    const api = {
        version: 1,
        registerParticipant,
        registerParticipants,
        unregisterParticipant,
        setParticipantEnabled,
        command,
        dispatch,
        claim,
        release,
        subscribe,
        emitEvent: _emitEvent,
        inspect,
        validateRuntime,
        snapshotDiagnostics,
        getDiagnostics: snapshotDiagnostics,
        registerCompatibilityShim,
        recordUserOverride,
    };

    window.slopsmith.capabilities = api;

    registerParticipant('core', {
        playback: {
            roles: ['owner', 'provider'],
            commands: ['play', 'pause', 'stop', 'seek', 'snapshot', 'audio-element', 'loop-set', 'loop-clear', 'loop-get'],
            events: ['song:loading', 'song:play', 'song:ready', 'song:arrangement-changed', 'song:position-changed', 'song:seek', 'song:pause', 'song:resume', 'song:stop', 'song:ended', 'loop:restart', 'beats:loaded'],
            compatibility: 'none',
            handlers: {
                play: (ctx) => _playbackCommand('play', ctx),
                pause: (ctx) => _playbackCommand('pause', ctx),
                stop: (ctx) => _playbackCommand('stop', ctx),
                seek: (ctx) => _playbackCommand('seek', ctx),
                'audio-element': () => _playbackAudioElementCommand(),
                'loop-set': (ctx) => _playbackLoopCommand('loop-set', ctx),
                'loop-clear': (ctx) => _playbackLoopCommand('loop-clear', ctx),
                'loop-get': (ctx) => _playbackLoopCommand('loop-get', ctx),
                snapshot: () => _coreHandled(_playbackSnapshot()),
            },
        },
        'ui.player-controls': {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('ui.player-controls', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('ui.player-controls', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('ui.player-controls', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('ui.player-controls', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('ui.player-controls', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('ui.player-controls', 'inspect', ctx),
            },
        },
        'ui.player-panels': {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('ui.player-panels', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('ui.player-panels', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('ui.player-panels', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('ui.player-panels', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('ui.player-panels', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('ui.player-panels', 'inspect', ctx),
            },
        },
        'ui.navigation': {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('ui.navigation', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('ui.navigation', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('ui.navigation', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('ui.navigation', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('ui.navigation', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('ui.navigation', 'inspect', ctx),
            },
        },
        'ui.plugin-screens': {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('ui.plugin-screens', 'inspect', ctx),
            },
        },
        'ui.player-overlays': {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('ui.player-overlays', 'inspect', ctx),
            },
        },
        settings: {
            roles: ['owner', 'provider'],
            commands: ['register-contribution', 'mount', 'unmount', 'set-visible', 'reorder-by-policy', 'inspect'],
            compatibility: 'none',
            handlers: {
                'register-contribution': (ctx) => _rememberUiContributionCommand('settings', 'register-contribution', ctx),
                mount: (ctx) => _rememberUiContributionCommand('settings', 'mount', ctx),
                unmount: (ctx) => _rememberUiContributionCommand('settings', 'unmount', ctx),
                'set-visible': (ctx) => _rememberUiContributionCommand('settings', 'set-visible', ctx),
                'reorder-by-policy': (ctx) => _rememberUiContributionCommand('settings', 'reorder-by-policy', ctx),
                inspect: (ctx) => _rememberUiContributionCommand('settings', 'inspect', ctx),
            },
        },
        plugins: {
            roles: ['owner', 'provider'],
            commands: ['enable', 'disable', 'install-missing', 'update', 'inspect'],
            events: ['enablement-changed'],
            compatibility: 'none',
            handlers: {
                enable: (ctx) => _rememberCoreDomainCommand('plugins', ctx),
                disable: (ctx) => _rememberCoreDomainCommand('plugins', ctx),
                'install-missing': (ctx) => _rememberCoreDomainCommand('plugins', ctx),
                update: (ctx) => _rememberCoreDomainCommand('plugins', ctx),
                inspect: () => _inspectCoreDomain('plugins'),
            },
        },
        'configuration-sources': {
            roles: ['owner', 'provider'],
            commands: ['list', 'add', 'refresh', 'update', 'inspect', 'trust', 'untrust', 'remove', 'validate'],
            events: ['source.added', 'source.refreshed', 'source.updated', 'source.trusted', 'source.untrusted', 'source.removed', 'source.validation-failed'],
            compatibility: 'none',
            handlers: {
                list: () => _inspectCoreDomain('configuration-sources'),
                add: (ctx) => _rememberSourceCommand('add', ctx),
                refresh: (ctx) => _rememberSourceCommand('refresh', ctx),
                update: (ctx) => _rememberSourceCommand('update', ctx),
                inspect: () => _inspectCoreDomain('configuration-sources'),
                trust: (ctx) => _rememberSourceCommand('trust', ctx),
                untrust: (ctx) => _rememberSourceCommand('untrust', ctx),
                remove: (ctx) => _rememberSourceCommand('remove', ctx),
                validate: (ctx) => _rememberSourceCommand('validate', ctx),
            },
        },
        profiles: {
            roles: ['owner', 'provider'],
            commands: ['list', 'preview', 'apply', 'stop-and-apply', 'queue-until-idle', 'restore', 'export', 'import', 'validate', 'save-drift-as-profile'],
            events: ['profile.previewed', 'profile.applied', 'profile.restored', 'profile.imported', 'profile.exported', 'profile.queued', 'profile.drift-detected', 'profile.validation-failed', 'profile.blocker-changed', 'profile.support-diagnostics'],
            compatibility: 'none',
            handlers: {
                list: () => _inspectCoreDomain('profiles'),
                preview: (ctx) => _rememberProfileCommand('preview', ctx),
                apply: (ctx) => _rememberProfileCommand('apply', ctx),
                'stop-and-apply': (ctx) => _rememberProfileCommand('stop-and-apply', ctx),
                'queue-until-idle': (ctx) => _rememberProfileCommand('queue-until-idle', ctx),
                restore: (ctx) => _rememberProfileCommand('restore', ctx),
                export: (ctx) => _rememberProfileCommand('export', ctx),
                import: (ctx) => _rememberProfileCommand('import', ctx),
                validate: (ctx) => _rememberProfileCommand('validate', ctx),
                'save-drift-as-profile': (ctx) => _rememberProfileCommand('save-drift-as-profile', ctx),
            },
        },
        'settings-packs': {
            roles: ['owner', 'provider'],
            commands: ['list', 'preview', 'apply', 'rollback', 'export-current', 'import', 'remove', 'validate'],
            events: ['pack.previewed', 'pack.applied', 'pack.imported', 'pack.exported', 'pack.removed', 'pack.validation-failed'],
            compatibility: 'none',
            handlers: {
                list: () => _inspectCoreDomain('settings-packs'),
                preview: (ctx) => _rememberSettingsPackCommand('preview', ctx),
                apply: (ctx) => _rememberSettingsPackCommand('apply', ctx),
                rollback: (ctx) => _rememberCoreDomainCommand('settings-packs', ctx),
                'export-current': (ctx) => _rememberSettingsPackCommand('export-current', ctx),
                import: (ctx) => _rememberSettingsPackCommand('import', ctx),
                remove: (ctx) => _rememberSettingsPackCommand('remove', ctx),
                validate: (ctx) => _rememberSettingsPackCommand('validate', ctx),
            },
        },
        diagnostics: {
            roles: ['owner', 'provider'],
            commands: ['snapshot', 'pipeline.resolve', 'pipeline.inspect', 'pipeline.validate', 'pipeline.participant.set-enabled'],
            events: ['pipeline.resolved', 'runtime.validated', 'participant.state-changed'],
            compatibility: 'none',
            handlers: {
                snapshot: () => _coreHandled(snapshotDiagnostics()),
                'pipeline.resolve': (ctx) => _coreHandled(inspect(ctx.target && ctx.target.capability)),
                'pipeline.inspect': (ctx) => _coreHandled(inspect(ctx.target && ctx.target.capability)),
                'pipeline.validate': () => _coreHandled(validateRuntime({ phase: 'diagnostics-command' })),
                'pipeline.participant.set-enabled': (ctx) => _coreHandled(setParticipantEnabled(
                    ctx.target && ctx.target.pluginId,
                    ctx.target && ctx.target.capability,
                    !!(ctx.target && ctx.target.enabled),
                    { requester: ctx.requester, reason: ctx.reason }
                )),
            },
        },
        'audio-mix': {
            roles: ['owner', 'provider'],
            commands: ['register-participant'],
            compatibility: 'none',
            handlers: {
                'register-participant': (ctx) => {
                    audioMixParticipants.push({ requester: ctx.requester, payload: ctx.payload || {}, timestamp: _now() });
                    return _coreHandled({ participants: audioMixParticipants.slice() });
                },
            },
        },
        'audio-monitoring': {
            roles: ['provider'],
            commands: ['start', 'stop'],
            events: ['state-changed'],
            compatibility: 'degrade-noop',
            handlers: {
                start: (ctx) => {
                    audioMonitoring.set(ctx.requester, { state: 'started', timestamp: _now() });
                    return _coreHandled({ requester: ctx.requester, state: 'started' });
                },
                stop: (ctx) => {
                    audioMonitoring.set(ctx.requester, { state: 'stopped', timestamp: _now() });
                    return _coreHandled({ requester: ctx.requester, state: 'stopped' });
                },
            },
        },
        'backend.routes': {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect'],
            events: ['route.registered'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('backend.routes', ctx),
                inspect: () => _inspectCoreDomain('backend.routes'),
            },
        },
        jobs: {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect', 'cancel'],
            events: ['job.registered', 'job.started', 'job.completed', 'job.failed', 'job.canceled'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('jobs', ctx),
                inspect: () => _inspectCoreDomain('jobs'),
                cancel: (ctx) => _rememberCoreDomainCommand('jobs', ctx),
            },
        },
        'midi-control': {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect'],
            events: ['midi-message', 'participant.registered'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('midi-control', ctx),
                inspect: () => _inspectCoreDomain('midi-control'),
            },
        },
        'audio-input': {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect'],
            events: ['input-ready', 'input-ended', 'participant.registered'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('audio-input', ctx),
                inspect: () => _inspectCoreDomain('audio-input'),
            },
        },
        'note-detection': {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect'],
            events: ['note.detected', 'participant.registered'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('note-detection', ctx),
                inspect: () => _inspectCoreDomain('note-detection'),
            },
        },
        'tempo-clock': {
            roles: ['owner', 'provider'],
            commands: ['register', 'inspect'],
            events: ['tempo.changed', 'beat', 'participant.registered'],
            compatibility: 'degrade-noop',
            handlers: {
                register: (ctx) => _rememberCoreDomainCommand('tempo-clock', ctx),
                inspect: () => _inspectCoreDomain('tempo-clock'),
            },
        },
        visualization: {
            roles: ['owner', 'provider'],
            commands: ['register-provider', 'get-current', 'set-renderer'],
            events: ['renderer:ready', 'reverted'],
            compatibility: 'shim-allowed',
            handlers: {
                'register-provider': (ctx) => {
                    const provider = { requester: ctx.requester, payload: ctx.payload || {}, timestamp: _now() };
                    const existingIndex = visualizationProviders.findIndex(item => item.requester === ctx.requester);
                    if (existingIndex >= 0) visualizationProviders.splice(existingIndex, 1, provider);
                    else visualizationProviders.push(provider);
                    return _coreHandled(_visualizationSnapshot());
                },
                'get-current': () => _coreHandled(_visualizationSnapshot()),
                'set-renderer': (ctx) => _setVisualization(ctx),
            },
        },
        pipeline: {
            roles: ['owner', 'provider'],
            commands: ['resolve', 'inspect', 'validate', 'participant.set-enabled'],
            events: ['resolved', 'runtime.validated', 'participant.state-changed'],
            compatibility: 'none',
            handlers: {
                resolve: (ctx) => _coreHandled(inspect(ctx.target && ctx.target.capability)),
                inspect: (ctx) => _coreHandled(inspect(ctx.target && ctx.target.capability)),
                validate: () => _coreHandled(validateRuntime({ phase: 'pipeline-command' })),
                'participant.set-enabled': (ctx) => _coreHandled(setParticipantEnabled(
                    ctx.target && ctx.target.pluginId,
                    ctx.target && ctx.target.capability,
                    !!(ctx.target && ctx.target.enabled),
                    { requester: ctx.requester, reason: ctx.reason }
                )),
            },
        },
    });
    try {
        window.dispatchEvent(new CustomEvent('slopsmith:capabilities:ready', { detail: api }));
        _notifySubscribers('registered', { capability: '*', pluginId: 'core', timestamp: _now() });
    } catch (_) {}
})();