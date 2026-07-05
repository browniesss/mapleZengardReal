# FSM — `StateComponent` + `@State` StateType

## 0. When to use FSM

| Pattern | Fit |
|---------|-----|
| **FSM** (`StateComponent`) | Simple enemies (3~5 states), player IDLE/HIT/DEAD, boss phase branching, **automatic avatar animation sync** (`AvatarStateAnimationComponent`) |
| **BT** (`AIComponent`) | Patrol + chase + attack composition, varied boss patterns, probability-weighted actions, Composite/Decorator reuse → [`ai-bt.md`](ai-bt.md) |

Both are native. **If you want to drive behavior with states and bind those states to motion, prefer FSM.** Use BT when the decision tree is deep or node reuse is essential.

---

## 1. `StateComponent` API

```
@Component StateComponent
  readonly @Sync property string CurrentStateName = "IDLE"

  method boolean AddState(string stateName, Type stateType)
  method boolean AddCondition(string stateName, string nextStateName, boolean reverseResult = false)
  method boolean ChangeState(string stateName)
  method void    RemoveState(string name)
  method void    RemoveCondition(string stateName, string nextStateName)
```

`StateChangeEvent` payload: `CurrentStateName`, `PrevStateName`, `IsInitial`. `DeadEvent` / `ReviveEvent` / `StateChangeEvent` are all auto-emitted by the engine — you only need to subscribe.

---

## 2. State name rules — **MUST**

### 2-1. UPPERCASE enforced

State names **must be uppercase**. `ChangeState("attack")`/`AddState("attack", ...)` are both rejected:

```
[LEA-3005] InvalidArgument : 'stateName' is not a valid argument.
State name must be UPPERCASE. Same state name exists in uppercase. (warning)
```

→ Always UPPER like `"ATTACK"`, `"PATROL"`, `"PHASE2"`.

### 2-2. Pre-registration required

The `name` argument of `ChangeState(name)` / `AddCondition(name, ...)` **must be a name pre-registered via `AddState`**. Unregistered names immediately produce:

```
[LEA-3005] InvalidArgument : 'stateName' is not a valid argument.
```

> **Common user pitfall**: calling `StateComponent:ChangeState("ATTACK")` inside `MonsterAttack:OnAttack` without having pre-registered `ATTACK` via `AddState`. → The error above fires and the attack motion never plays.

### 2-3. States registered by default

When `StateComponent` is attached, the **auto-registered states** are:

| State | Condition | Notes |
|-------|-----------|-------|
| `IDLE` | Always | Initial `CurrentStateName` |
| `DEAD` | Always | Triggers `EmitDeadEvent` |
| `HIT`  | Only if the same entity has a `HitComponent` | Auto-returns to `IDLE` 0.5s later (`AddCondition("HIT", "IDLE", ...)`) |
| `MOVE` | When `AIChaseComponent` or `AIWanderComponent` is attached | Dedicated to native BT chase/wander |

All others — `ATTACK`, `PATROL`, `STUN`, `PHASE2`, ... — must be registered manually via `AddState`.

---

## 3. Custom StateType — user-defined via `@State`

> **Both `@State` and `extends StateType` are required.** If either is missing the build may pass but the `.codeblock` is not generated → `AddState("XXX", XXX)` effectively receives a nil type and registration fails. (Same as the BT `@BTNode` pattern.)

### Lifecycle

| Method | When called |
|--------|-------------|
| `OnEnter()` | Once, right after entering this state via `ChangeState` |
| `OnUpdate(number delta)` | Every frame while in this state |
| `OnExit()` | Once, right before exiting to another state |
| `OnConditionCheck() → boolean` | Per-frame check for transitions where this state is `from` in an `AddCondition`. **Called every frame.** |

`StateType.ParentComponent` (readonly) → the `StateComponent` that owns this state. From there you can walk back to `Entity` to access components/memory.

### Authoring example — `AttackStateType`

```lua
@State
script AttackStateType extends StateType
    property number Duration = 0.6
    property number Elapsed  = 0

    method void OnEnter()
        self.Elapsed = 0
        local entity = self.ParentComponent.Entity
        -- Fire the attack resolution once
        entity.AttackComponent:AttackFast(BoxShape2D(1, 1), "monster_attack", CollisionGroups.Player)
    end

    method void OnUpdate(number delta)
        self.Elapsed += delta
        if self.Elapsed >= self.Duration then
            self.ParentComponent:ChangeState("IDLE")
        end
    end

    method void OnExit()
        -- Cleanup (remove effects, etc.)
    end
end
```

### Registration — in the component's OnBeginPlay

```lua
@ExecSpace("ServerOnly")
method void OnBeginPlay()
    local sc = self.Entity.StateComponent
    sc:AddState("ATTACK", AttackStateType)
    sc:AddState("PATROL", PatrolStateType)
    -- ChangeState("ATTACK") is now valid
end
```

---

## 4. Auto transitions — `AddCondition`

Each frame the `OnConditionCheck()` of the `from` state is called, and **on `true` the state auto-transitions to `to`**.

```
method boolean AddCondition(string from, string to, boolean reverseResult = false)
```

- `reverseResult = true` → transition when `OnConditionCheck()` returns `false` (condition inverted)
- Multiple `to`s can be registered for the same `from` — checked in registration order; the first one that passes transitions
- If the `from` state is not a custom StateType (= deprecated updateFunction-based form), AddCondition is rejected

### Example — HP-based phase transition

```lua
@State
script Phase1StateType extends StateType
    method boolean OnConditionCheck()
        local monster = self.ParentComponent.Entity.MonsterScript
        return monster.Hp <= monster.MaxHp * 0.5
    end
end

-- Registration
sc:AddState("PHASE1", Phase1StateType)
sc:AddState("PHASE2", Phase2StateType)
sc:AddCondition("PHASE1", "PHASE2")   -- Auto-transitions when HP drops below half
```

For a forced transition from script just call `sc:ChangeState("PHASE2")`.

---

## 5. `ChangeState` semantics

| Call | Result |
|------|--------|
| Unregistered name | `[LEA-3005]` + returns `false` |
| Lowercase name | `[LEA-3005]` + UPPERCASE warning + returns `false` |
| Same as current state | Returns `false` (no transition, `OnEnter` not re-called) |
| `currentState == "DEAD"` and target other than `"IDLE"` | `[LEA-?] InvalidOperation` + returns `false` |
| `UpdateAuthority = Server` but called on the client | `[LEA-?] InvalidExecSpace` + returns `false` |
| Normal | `OnExit(prev) → OnEnter(new) → EmitStateChangeEvent` in order. Returns `true` |

### `DEAD` lock

When `CurrentStateName == "DEAD"`, **no transition to any state other than `IDLE` is allowed**. The revive flow must go through `ChangeState("IDLE")`. A direct `DEAD → REVIVE` jump in a boss revive sequence silently fails.

---

## 6. Avatar animation mapping is **separate**

Even if you register an `"ATTACK"` key in `AvatarStateAnimationComponent.StateToAvatarBodyActionSheet` (or the deprecated `ActionSheet`), **the `ATTACK` state is not auto-registered in `StateComponent`.** The two areas are fully separate:

| Area | Role |
|------|------|
| `StateComponent.AddState("ATTACK", AttackStateType)` | Defines the **existence** and **behavior** (OnEnter/OnUpdate/OnExit) of the state |
| `AvatarStateAnimationComponent.StateToAvatarBodyActionSheet["ATTACK"]` | Maps the motion to play **when that state is active** |

Filling only `ActionSheet` and omitting `AddState` → `ChangeState("ATTACK")` fails → the motion does not play either.

> By convention, the motion key and the state key are kept as the same string (`"ATTACK"`, `"HIT"`, `"DEAD"`).

---

## 7. UpdateAuthority — server/client split

If `StateComponent.UpdateAuthority` is `Server` (default), `ChangeState`/`AddState`/`AddCondition` can only be called **on the server**. Calling from the client triggers `[LEA-?] InvalidExecSpace`.

→ Wrapping the FSM operation methods in `@ExecSpace("ServerOnly")` is the safe approach.
→ To know the state on the client, read the `@Sync CurrentStateName` or subscribe to `StateChangeEvent`.

---

## 8. Standard pattern — monster IDLE/PATROL/CHASE/ATTACK/HIT/DEAD

```lua
@Component
script MonsterFSM extends Component
    @ExecSpace("ServerOnly")
    method void OnBeginPlay()
        local sc = self.Entity.StateComponent
        sc:AddState("PATROL", PatrolStateType)
        sc:AddState("CHASE",  ChaseStateType)
        sc:AddState("ATTACK", AttackStateType)
        -- IDLE / DEAD / HIT are auto-registered

        -- Auto transitions
        sc:AddCondition("PATROL", "CHASE")     -- PatrolStateType:OnConditionCheck() = player detected
        sc:AddCondition("CHASE",  "ATTACK")    -- ChaseStateType:OnConditionCheck()  = entered attack range
        sc:AddCondition("ATTACK", "CHASE")     -- AttackStateType:OnConditionCheck() = cooldown ended
        sc:AddCondition("CHASE",  "PATROL")    -- ChaseStateType:OnConditionCheck()  = target lost (split via reverseResult)

        sc:ChangeState("PATROL")
    end
end
```

If each StateType's `OnConditionCheck` inspects distance, cooldown, and target validity, then `OnUpdate` is left to handle behavior only → a clean separation.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[LEA-3005] InvalidArgument : 'stateName'` at `ChangeState`/`AddCondition` | Unregistered name or lowercase | Check that `AddState` was called in `OnBeginPlay` and that the name is UPPERCASE |
| `State name must be UPPERCASE` warning | Lowercase argument | Uppercase the name |
| `AddState` succeeded but `OnEnter` is never called | Missing `@State` annotation or `extends StateType` → `.codeblock` not generated | Include both lines and `refresh` |
| State transitions but motion does not change | `AvatarStateAnimationComponent` not attached or key missing in `StateToAvatarBodyActionSheet` | Register the clip RUID under a key matching the state name |
| `ChangeState` always returns false | Locked by `currentState == "DEAD"` or called from `Client` | Route revive through `IDLE` / use `@ExecSpace("ServerOnly")` |
| `OnConditionCheck` is not called | The `from` state is in the deprecated `AddState(name, func)` form | Migrate to `Type`-based `AddState(name, XxxStateType)` |

---

## 10. Checklist

- [ ] Custom StateType scripts include both `@State` and `extends StateType`
- [ ] After `refresh`, a `.codeblock` with the same name exists next to the custom StateType `.mlua` — if missing, the annotation or extends is missing
- [ ] All state names are **UPPERCASE** (`"ATTACK"` ✓, `"attack"` ✗)
- [ ] Before calling `ChangeState`, `AddState` was called with that name in `OnBeginPlay`
- [ ] All states other than the 4 auto-registered (`IDLE`/`DEAD`/`HIT`/`MOVE`) require manual registration
- [ ] FSM operation methods use `@ExecSpace("ServerOnly")` (assuming UpdateAuthority=Server)
- [ ] No direct jumps from `DEAD` to states other than `IDLE`
- [ ] Keys in `AvatarStateAnimationComponent.StateToAvatarBodyActionSheet` exactly match the state names registered in `StateComponent`
- [ ] When using auto transitions, `OnConditionCheck` is a cheap check even though it runs every frame (heavy work belongs in `OnUpdate`)
- [ ] `DisconnectEvent` external event handlers in `OnEndPlay` (if the StateType subscribed to events)
