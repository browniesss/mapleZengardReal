# Monster setup — 9 components + ActionSheet

> AI FSM / StateComponent details → [`msw-combat-system/SKILL.md`](../SKILL.md) §7

---

## 9 required components

| # | Component | Role | Notes |
|---|-----------|------|-------|
| 1 | `TransformComponent` | Position / rotation / scale | Default on every entity |
| 2 | `SpriteRendererComponent` | Sprite / animation render | `SpriteRUID` = stand clip RUID |
| 3 | `StateAnimationComponent` | Per-state animation clip mapping | `ActionSheet` is a key-RUID dictionary |
| 4 | `StateComponent` | State machine (IDLE/MOVE/DEAD etc.) | AI components auto-register their states |
| 5 | Body (`Rigidbody` / `Kinematicbody` / `Sideviewbody`) | Physics / gravity / movement | Must match the map type (table below) |
| 6 | `MovementComponent` | Movement speed control | `InputSpeed` multiplier |
| 7 | `AIWanderComponent` **or** `AIChaseComponent` | AI behavior pattern | Do not use both |
| 8 | `HitComponent` | Hit-detection hitbox | `IsLegacy=false` required |
| 9 | `DamageSkinSpawnerComponent` | Damage number display on hit | Auto, no setup required |

### Body ↔ map type mapping

| TileMapMode | Body component |
|-------------|----------------|
| MapleTile | `MOD.Core.RigidbodyComponent` |
| RectTile | `MOD.Core.KinematicbodyComponent` |
| SideViewRectTile | `MOD.Core.SideviewbodyComponent` |

Map type check: [`msw-general/references/platform.md`](../../msw-general/references/platform.md) §4. Per-Body knockback differences: [`msw-combat-system/SKILL.md`](../SKILL.md) §3-1.

---

## Component composition — MapleTile baseline

Add the following 9 native + 1 custom component to the `.model`.

| Component | Key values |
|-----------|------------|
| `MOD.Core.TransformComponent` | (default) |
| `MOD.Core.SpriteRendererComponent` | `SpriteRUID = <stand clip RUID>`, `OrderInLayer = 2`, `SortingLayer = "MapLayer0"`, `PlayRate = 1.0` |
| `MOD.Core.StateAnimationComponent` | `ActionSheet` (5 states, see §ActionSheet below) |
| `MOD.Core.StateComponent` | (default) — AI components auto-register states |
| `MOD.Core.RigidbodyComponent` | `Gravity = 1.0`, `WalkSpeed = 1.4`, `LayerSettingType = 2` (RectTile→`KinematicbodyComponent`, SideViewRectTile→`SideviewbodyComponent`) |
| `MOD.Core.MovementComponent` | `InputSpeed = 1.0` |
| `MOD.Core.AIWanderComponent` **or** `AIChaseComponent` | `IsLegacy = false` |
| `MOD.Core.HitComponent` | `IsLegacy = false`, `ColliderType = 1`(Box), `BoxSize = (1.15, 0.87)`, `ColliderOffset = (0.0, 0.425)`, `CollisionGroup.Id = "MOD@HitBox"` |
| `MOD.Core.DamageSkinSpawnerComponent` | (default) |
| `MonsterAI` (custom) | Write the `.mlua` → run Maker **Refresh once** → after the `.codeblock` is auto-generated, can be included directly in the `.model` as a component |

> **⚠ Do not place custom scripts in the `.model` before Refresh** — when deserialized without a `.codeblock`, they are silently excluded (CLAUDE.md common pitfall #4). After Refresh they can sit in the `.model` just like native components.

---

## StateAnimationComponent — ActionSheet 5 states

The ActionSheet key must **exactly match** the animationclip element name in the resource pack.

| Key | Description | Required |
|-----|-------------|----------|
| `stand` | Idle | ✅ |
| `move` | Movement | ✅ |
| `attack` | Attack motion | Required for combat monsters |
| `hit` | Hit reaction | Recommended |
| `die` | Death motion | Recommended |

Map them inside `StateAnimationComponent.ActionSheet` in the `.model` JSON:

```json
{
  "@type": "MOD.Core.StateAnimationComponent",
  "ActionSheet": {
    "stand":  "<stand clip RUID>",
    "move":   "<move clip RUID>",
    "attack": "<attack clip RUID>",
    "hit":    "<hit clip RUID>",
    "die":    "<die clip RUID>"
  },
  "Enable": true
}
```

Resource pack search → obtain animationclip RUIDs from elements → map per key, in order.

---

## AI component details

### AIWanderComponent (wanderer)

Wanders autonomously near the spawn position. Ignores the player.

```
property boolean IsLegacy = false          -- must be false
property boolean LogEnabled = false
property UpdateAuthorityType UpdateAuthority = UpdateAuthorityType.Server

method BTNode CreateLeafNode(string nodeName, func<float> -> BehaviourTreeStatus)
method BTNode CreateNode(string nodeType, string nodeName, func<float> -> BehaviourTreeStatus)
method void SetRootNode(BTNode node)
```

Just adding the component (without custom BT nodes) yields default wander behavior. For advanced patrol routes, build a BT directly via `SetRootNode`.

### AIChaseComponent (chaser)

Auto-chases any player inside the detection range. Stops chasing on range exit.

```
property float DetectionRange = 5          -- detection radius (units)
property boolean IsChaseNearPlayer = true  -- true: auto-chase the nearest player
property EntityRef TargetEntityRef         -- fixed target entity
property boolean IsLegacy = false          -- must be false

method Entity GetCurrentTarget()           -- return the current chase target
method void SetTarget(Entity targetEntity) -- set a fixed target (auto-disables IsChaseNearPlayer)
method BTNode CreateLeafNode / CreateNode / SetRootNode  -- BT customization
```

### Switching pattern (swap AI from script)

```lua
-- Wander → Chase swap (dynamic swap from script)
entity:RemoveComponent("AIWanderComponent")
entity:AddComponent("AIChaseComponent")
local chase = entity.AIChaseComponent
chase.DetectionRange = 8.0
```

> `.model`-level swap: replace the `AIWanderComponent` entry with an `AIChaseComponent` entry, then Maker Refresh.

### ⚠️ Do not use together with a custom chase/movement script

`AIChaseComponent` / `AIWanderComponent` **run a BehaviorTree every frame in OnUpdate and overwrite the Body velocity directly.**

- Chase node (`Chase`): if the target is within `DetectionRange` (default 5 units), calls `MovementComponent.MoveToDirection(dir)` → `Body.SetVelocity(dir)`
- Stop node (`Stop`): if the target is out of range or absent, every frame calls `MoveToDirection(zero)` → **forces velocity = 0**
- Additionally, on `FinishedConstruct` it force-overwrites Rigidbody properties: `WalkSpeed=0.5, WalkAcceleration=0.5, WalkDrag=1000, IsolatedMove=true` (on MapleTile)

**Symptom**: Even if a custom chase script tries to chase via `body.MoveVelocity = (vx, vy)`, AIChase immediately overwrites it the next frame. Outside 5 units it gets stomped to 0 every frame, so **the monster appears stuck.** Changing Rigidbody settings is ignored (WalkSpeed is pinned to 0.5).

**Resolution**: If you use a custom AI, **completely remove** `AIChaseComponent` / `AIWanderComponent` from the `.model`. Partial use does not work — leaving either of them in causes the conflict above.

Procedure (Maker Inspector):
1. Open the target `.model` in Maker and delete `AIChaseComponent` / `AIWanderComponent` from the Components panel.
2. Explicitly re-set `RigidbodyComponent.WalkSpeed` to the desired value (e.g. `1.4`) — prevents the `0.5` residue from the AIComponent's force-overwrite.
3. Save, then apply the change via MCP `refresh`.

If you want to keep only part of `AIChase`'s BT, you can leave the component but swap the BT root via `SetRootNode` to disable the default Stop/Chase behavior — but **removal is recommended**.

---

## HitComponent hitbox calculation

1. Inspect the sprite's actual bounds (sprite size ÷ PPU or via the editor)
2. `BoxSize` = same as bounds.size, or slightly smaller
3. `ColliderOffset` = `(bounds.center.x − position.x, bounds.center.y − position.y)`

```
-- Example: bounds.size=(1.15, 0.87), bounds.center=(-1.80, 1.19), position=(-1.66, 0.77)
BoxSize = (1.15, 0.87)
ColliderOffset = (-1.80 - (-1.66), 1.19 - 0.77) = (-0.14, 0.42)
```

`CollisionGroup.Id = "MOD@HitBox"` — without this, `AttackComponent:Attack(..., CollisionGroups.Monster)` will not interact.

### Sprite-pivot-based dynamic collider (runtime calculation)

Instead of computing steps 1~3 by hand, automatically derive `BoxSize` and `PositionOffset` in `OnBeginPlay` from the first-frame sprite metadata of the `AnimationClip` — same code reused across monsters of varying size (especially for contact-attack areas like `MonsterAttack`).

```lua
@ExecSpace("ServerOnly")
method void OnBeginPlay()
    local clip = _ResourceService:LoadAnimationClipAndWait(self.Entity.SpriteRendererComponent.SpriteRUID)
    local sprite = clip.Frames[1].FrameSprite
    local sizePx = Vector2(sprite.Width, sprite.Height)
    local ppu    = sprite.PixelPerUnit

    self.SpriteSize     = sizePx / ppu                                 -- world-unit size
    self.PositionOffset = (sizePx / 2 - sprite.PivotPixel:ToVector2()) / ppu  -- pivot correction
    -- Then in AttackNear etc.:
    --   local shape = BoxShape(myPos + self.PositionOffset, self.SpriteSize, 0)
end
```

All APIs used are documented in `.d.mlua` (`_ResourceService:LoadAnimationClipAndWait`, `Sprite.Width/Height/PixelPerUnit/PivotPixel`). Values are normalized to **workspace units (world units)**, so they can be used directly in `BoxShape` / `RectangleShape`.

> ⚠ `LoadAnimationClipAndWait` is a synchronous load (blocks the server for one frame). Call it once in `OnBeginPlay` and cache in `_T` or a property. Do not re-load every frame inside `OnUpdate`.

---

## Custom MonsterAI script

Write HP / damage logic in a separate `.mlua`. After one Maker Refresh it can sit directly in the `.model` alongside the native components.

```lua
@Component
script MonsterAI extends Component

    @Sync
    property number HP = 100

    @Sync
    property number MaxHP = 100

    property number Damage = 10

    method void OnBeginPlay()
        self.MaxHP = self.HP
    end

    @ExecSpace("ServerOnly")
    handler HandleHitEvent(HitEvent event)
        self.HP -= event.TotalDamage
        if self.HP <= 0 then
            self.Entity.StateComponent:ChangeState("DEAD")
        end
    end

    method void OnEndPlay()
        self.Entity:DisconnectEvent(HitEvent, self.HandleHitEvent)
    end

end
```

```lua
@ExecSpace("ServerOnly")
method void OnBeginPlay()
    local monster = _SpawnService:SpawnByModelId(
        "Monster_Mushroom",
        "mushroom_1",
        Vector3(100, -50, 999.999),
        self.Entity.CurrentMap     -- parent (must not be nil)
    )
    -- MonsterAI is included in the .model and auto-attached
end
```

---

## Speed / physics reference

| Monster type | WalkSpeed | Gravity | InputSpeed | AI |
|--------------|-----------|---------|------------|----|
| Slow field mob (snail) | 0.5~1.0 | 1.0 | 1.0 | AIWander |
| Standard field mob (mushroom) | 1.0~1.5 | 1.0 | 1.0 | AIWander |
| Fast field mob | 2.0~3.0 | 1.0 | 1.0 | AIWander |
| Chase monster | 1.5~2.5 | 1.0 | 1.0 | AIChase |
| Flying monster | 1.0~2.0 | 0.0 | 1.0 | AIWander/AIChase |

Actual movement speed = `InputSpeed × WalkSpeed`. Per-map-type conversion → [`msw-general/references/platform.md` §10](../../msw-general/references/platform.md).

---

## Checklist

- [ ] Body matches the TileMapMode (MapleTile=Rigidbody, RectTile=Kinematic, SideViewRectTile=Sideview)
- [ ] `SpriteRUID` set (stand clip RUID)
- [ ] `StateAnimationComponent.ActionSheet` maps 5 state keys to RUIDs
- [ ] `HitComponent.IsLegacy = false`, `CollisionGroup.Id = "MOD@HitBox"`
- [ ] Only one AI component (`AIWander` **or** `AIChase`, never both)
- [ ] `AIWanderComponent.IsLegacy = false` / `AIChaseComponent.IsLegacy = false`
- [ ] `DamageSkinSpawnerComponent` included (auto damage-number display)
- [ ] Custom scripts are included directly in `.model` only after one Maker Refresh (must be excluded before Refresh)
