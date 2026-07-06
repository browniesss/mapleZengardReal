# 메이플 젠가드 — 플레이어 캐릭터 & 능력치 시스템 설계서

> **DRAFT v0.2** · 2026-07-05 · 담당: 플레이어블 캐릭터 전 범위 (보드판/기믹·위치 재배치 제외)
> 근거: 최신 사양서(HTML/인게임규칙 PDF) > 5차 기획서 초안 PDF + **보드 시스템 실제 코드(main 머지분)**
> v0.1 → v0.2: 보드 as-built 분석 반영 — 좌표계·Modifier 계약·통합 지점 전면 개정

---

## 0. 결정 사항 (v0.1 가정 해소)

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| A1 | 멀티 모델 | **개인 보드 확정** — 유저 입장마다 `BoardMap` 동적맵 복제(`_run{N}`) 후 이동 | `BoardRenderProbe.OnUserEnter` 코드로 검증됨 |
| A2 | 데미지 경계 | HitPlan 산출까지 우리, HP/사망은 몬스터 측 — **몬스터/웨이브 담당 미확정, 인터페이스만 잠금** | BoardService 주석 "유닛 비주얼은 웨이브/몬스터 시스템 소유" |
| A3 | UI 범위 | 캐릭터 UI는 **후속 작업** (로직+이벤트 먼저) | 사용자 확정 |
| A4 | 동료 | 컴포넌트 공용 설계만, 구현은 **사양 확정 후** | 사용자 확정 |

---

## 1. 보드 시스템 as-built 분석 (통합 전제)

보드 담당자 코드(`RootDesk/MyDesk/Board/`)에서 확인된 계약. **우리 시스템은 이것을 따른다.**

### 1.1 구조 요약

| 레이어 | 스크립트 | 역할 |
|---|---|---|
| ② 카탈로그 | `BoardCatalogLogic` (@Logic) | 데이터셋(serveronly) → def 파싱·검증·**lazy 캐시 + deep-copy 게터**. `GetBoardDef/GetStageDef/GetCellTypes/GetObjectType/GetAuraType/GetItemType` |
| ③ 서비스 | `BoardService` (@Logic, **무상태**) | 지오메트리(CellToWorld/WorldToCell), 레이어드 점유(unit/object/aura/item), CanPlace/TryOccupy/Release, ResolvePlacement(random/fixed/center/zone), BuildBoard, **BlocksSkill**, **OnUnitEnter/OnUnitExit(→Modifier[])** |
| 오케스트레이터 | `BoardRenderProbe` (@Logic, 임시) | UserEnter → 동적맵 복제 → 플레이어 이동 → BuildBoard. `runs[runMapName] = run` 보관. (후속으로 `BoardFlowLogic`이 젠/웨이브 페이즈 담당 예정 — `ApplyWavePlacements` 주석) |
| 유틸 | `Zengard/Util/JsonUtil` | CSV의 중첩 JSON 셀 디코드 (`_HttpService` 래퍼) |

### 1.2 우리가 따라야 할 계약 5가지

1. **좌표계 = `(col, row)`**, 0-based, 키 `"col_row"`. `CellToWorld`: row가 클수록 world y가 큼(위쪽), 작은 row가 앞(z 작음). cellSize는 레이아웃 데이터(classic_7x7=0.8).
2. **Modifier 계약** (이미 데이터·코드에 존재 — 우리 스탯 시스템의 입력 포맷):
   ```json
   { "stat": "atk", "type": "percentMult" | "percentAdd" | "flat",
     "value": 0.3, "source": "aura:rage", "duration": "turns:3" (생략=소스관리) }
   ```
   - 보드의 `OnUnitEnter(칸 진입) → Modifier[]` / `OnUnitExit → 해제할 source[]`가 **우리 `PlayerStatComponent`로 유입**되는 것이 설계된 통합 지점 (BoardService §8 주석: "보드는 Modifier[] 생성·전달만").
3. **run 핸들** — `run.board = { defId, mapEntityRef, originOffset, cells, instanceSeq, slots }`. 점유 상태는 여기에만 존재(서버). 우리 API는 **무상태로 (run, def)를 인자로 받는다** (BoardService와 동일 스타일).
4. **unit 레이어 점유** — `{ occupantId, occupantKind("monster"|"player"|"ally"), instanceId }`. 타겟 탐색은 `GetCellLayer(board,c,r,"unit")` / `GetOccupantCount`로.
5. **`BlocksSkill(def,board,c,r)`** — 스킬 차단 오브젝트(rock 등) 질의 훅이 이미 제공됨. 투사체 경로 스캔에서 필수 사용.

### 1.3 컨벤션 (그대로 채택)

- 데이터셋: `RootDesk/MyDesk/Zengard/Data/*.userdataset+csv`, 중첩 데이터는 **JSON 셀** (`_JsonUtil:Decode`), serveronly, id는 camelCase(단 스킬 ID는 기획 PK `ARC_DOUBLESHOT` 유지)
- 카탈로그 Logic 패턴: lazy 캐시 + deep-copy 게터 + `RunSelfTest` 프로퍼티 + 적재 시 검증/경고 로그
- 로그 prefix `[SystemName]`, 주석/로그 한국어, ServerOnly 권위

### 1.4 맵 모드 주의

- **인게임 보드 = RectTile(1)** (`BoardMap.map`), 로비 map01 = MapleTile(0).
- 보드 위 말은 슬롯(`BoardSlot`) 자식으로 **배치**되는 구조라 자체 이동 물리는 안 씀. 단 플레이어 아바타(DefaultPlayer)가 동적맵으로 이동되므로 RectTile에서는 Kinematicbody가 활성됨 — **아바타 조작 잠금/말 표현 방식은 §7 조율 필요**.

---

## 2. 좌표·회전 컨벤션 (v0.1 개정 — 보드 좌표계에 정렬)

- 스킬 범위 오프셋 = **`(dcol, drow)`**. 보드 `CellToWorld` 기준 **UP(화면 위) = `(0, +1)`**, RIGHT = `(+1, 0)`.
- 기획 grid 마스크(`"010"/"1P1"/"010"`) 파싱: **텍스트 첫 줄 = 가장 위 = drow가 큰 쪽**.
- 회전 = 시계방향 90° k회: `rotCW(dc, dr) = (dr, -dc)` · facing UP→k0, RIGHT→k1, DOWN→k2, LEFT→k3
  - 검증: UP (0,1) →R (1,0) →D (0,-1) →L (-1,0) ✓
- `dirDependent=false` 패턴(CROSS_4, AROUND_8, AROUND_R2)은 회전 미적용.

> ⚠️ **조율 필요**: 현 `BoardLayouts.csv`의 zone `"spawnTop"`이 row 0(= CellToWorld상 world 아래쪽)에 있음. "top" 명칭과 world 축이 상충 — 보드 담당자와 row 방향 의미(화면 기준) 통일 필요. 스킬 방향(facing)의 화면 표현이 여기 걸림.

---

## 3. 데이터 레이어 (`RootDesk/MyDesk/Zengard/Data/` — 보드 컨벤션 준수)

> **범위 결정(2026-07-05)**: 스킬 46종은 기획 미확정 → **테스트 스킬 8종만** 우선 등재 (직업 4종 × 시스템 축 커버: target/area/projectile, 방향 종속/무관, 속성, 온히트, 관통/횟수 태그). 46종 확정 시 CSV 행 추가만으로 반영.

| 데이터셋 | 주요 컬럼 | 비고 |
|---|---|---|
| `SkillMaster` (테스트 8행) | skillId, name, job(WAR/MAG/ARC/THF), tier(1~4), attackType(projectile/target/area), hitCount(**태그 제외 기본 타격수**), targetCount, rangeId, element(none/fire/ice/thunder/poison/holy), baseTags(JSON 배열), coefLv3, onHitStatus, cooldownTurns, iconRuid | 레어도는 tier에서 자동 유도(N/R/E/U). coefLv3=**기본 태그 포함 총계수** → 타격당 계수는 로드 시 산출(coefLv3 ÷ 기본 최종 타격수), Lv1=×0.75/Lv2=×0.88. hitCount를 태그 제외 기본값으로 두어 `hit2` 태그 이식 시 이중 계산 없이 타격수 가산 |
| `RangePattern` (6종+) | rangeId, facingBase(UP), dirDependent, grid(JSON `["010","1P1","010"]`) | 기획 마스크 그대로, 파서가 (dcol,drow) 변환·캐시 |
| `TagDef` | tagId, name, category(method/count/range/element), inSynthesisPool(method=false), effect(JSON: hitAdd/rangeAdd/pierce/element) | 중첩 규칙은 effect 키별 코드 규칙(count·range=가산, element=중첩 카운트). 태그별 커스텀 stackRule이 필요해지면 컬럼 추가 |
| `StatusEffectDef` | statusId(stun/freeze/poison/taunt/defIgnore), 파라미터 JSON | 효과 정의는 몬스터 측과 협의, 우리는 부여까지 |
| `GrowthCurve` | level, requiredExp | 판당 레벨업 6~10회 목표, 수치 플레이스홀더 |
| `JobBase` | job, baseAtk, critRate, critDmg, defPen, firstSkillPair(JSON) | **stat 키는 보드 Modifier와 동일: `atk`, `critRate`, `critDmg`, `defPen`** |

---

## 4. 런타임 구조

**철칙 (보드와 동일): per-player 상태는 플레이어 엔티티 `@Component`에만, `@Logic`은 캐시·순수계산만. 상태 변경 전부 ServerOnly, 클라는 @Sync+이벤트.**

### 4.1 @Logic — `RootDesk/MyDesk/Character/`

| 스크립트 | 책임 |
|---|---|
| `SkillCatalogLogic` | SkillMaster/RangePattern/TagDef/StatusEffectDef/GrowthCurve/JobBase 파싱·lazy 캐시·deep-copy 게터 (BoardCatalogLogic 미러) + grid→오프셋 변환 캐시 |
| `CombatResolveLogic` | **무상태** 공격 해석기. `(run, def)`를 인자로 받아 BoardService 질의로 타겟 확정 → HitPlan 산출 (§5) |

### 4.2 @Component (플레이어 엔티티 부착 — 동료 재사용 가능 설계)

```
PlayerRunComponent      런 수명주기: StartRun(job)→Lv.1 리셋+진입 선택지(2중1) / RestoreRun / EndRun
                        보드 run 핸들 참조 보관(런 시작 시 주입받음)

PlayerStatComponent     스탯 = JobBase + Modifier 스택 (§1.2-2 보드 계약 포맷 그대로)
  ApplyModifiers(mods)          -- 보드 OnUnitEnter 산출물/장비/버프스킬/아웃게임 공용 입구
  RemoveBySource(source)        -- 보드 OnUnitExit 산출물 처리
  TickTurnDurations()           -- "turns:N" 차감, 만료 제거 (턴 종료 훅)
  GetFinal(statKey)             -- (base + Σflat) × (1 + ΣpercentAdd) × Π(1 + percentMult)
  @Sync FinalAtk/FinalCritRate/FinalCritDmg/FinalDefPen + StatChangedEvent

SkillLoadoutComponent   attackSlots[3] + supportSlots[] · SkillInstance{skillId, level, tags[], cooldownLeft}
  AcquireSkill / ReplaceSkill(태그 METHOD 제외 랜덤 1계승) / SynthesizeTag / RerollTag / SetOrder
  TickCooldowns() · SkillLoadoutChangedEvent

PlayerGrowthComponent   AddExp → 레벨업 → RollChoices(레어도 N60/R28/E10/U2 × job·tier 필터 × 스킬90/장비10,
                        U는 4차 전용, 3→5 확장 파라미터) → CommitChoice(노출 카운트++)

PlayerJobComponent      job, tier(1~4), CanAdvance(선택지 3회 노출+전리품) / Advance(전리품 소모, 풀 해금)
```

### 4.3 @Event — `Character/Events/`

`LevelUpEvent` · `ChoicePresentedEvent` · `ChoiceCommittedEvent` · `SkillLoadoutChangedEvent` · `StatChangedEvent` · `AttackResolvedEvent` · `RunEndedEvent`

---

## 5. 공격 해석 파이프라인 (보드 API 직결)

```
_CombatResolveLogic:ResolveAttack(playerEntity, run, def, facing)   -- 젠 플로우(보드 측)가 호출
1. loadout.orderQueue 순회 (cooldownLeft > 0 스킵)
2. 각 스킬:
   a. RangePattern 오프셋 + RANGE 태그 스택만큼 방향 가산 확장
   b. dirDependent면 facing 회전 (§2)
   c. 절대 셀 = 플레이어 셀(run에서 조회) + (dcol,drow) · 맵 밖/void = _BoardService:IsInside로 버림(A안)
   d. attackType 해석 — 타겟은 _BoardService:GetCellLayer(board,c,r,"unit")에서 occupantKind="monster"만:
      projectile — 원점 가까운 순 경로 스캔, _BoardService:BlocksSkill(차단 오브젝트) 시 중단,
                   첫 적에서 멈춤(관통 태그 시 통과)
      target     — 범위 내 targetCount만큼 선택
      area       — 범위 내 전체, targetCount 상한
   e. perHit = FinalAtk × (coefLv3 × lvFactor / hitCount) · 크리 판정 · element/defPen/onHit 태깅
3. HitPlan = [{skillId, cell:{col,row}, targetInstanceId, occupantId, hitCount, damagePerHit,
              isCrit, element, defPen, onHitStatus}]
4. AttackResolvedEvent 발행 → 몬스터(HP)/연출/UI 소비 · 발동 스킬 쿨다운 개시
```

헛탕(범위 내 적 0) = 정상 결과. 속성 내성 적용은 몬스터 측(내성 테이블 소유자).

---

## 6. 저장

- **런 상태**(이어하기): `{version, job, tier, level, exp, choiceExposure, slots, orderQueue, cooldowns, modifiers(장비·아이템)}` — 보드 상태와 함께 상위 세이브 스키마로 (보드 담당자와 합의). `_DataStorageService`, ServerOnly, 배치 저장.
- **아웃게임**: 공통 능력치(내실 등)는 `ApplyModifiers(source="outgame:...")` 입구로만 수용.

---

## 7. 통합 조율 사항 (보드 담당자와 합의 필요)

| # | 항목 | 내용 | 제안 |
|---|---|---|---|
| I-1 | 젠/공격 페이즈 훅 | `BoardFlowLogic`(예정)이 공격 페이즈에 `ResolveAttack` 호출 + 턴 종료에 `TickCooldowns`/`TickTurnDurations` 호출 필요 | 커스텀 `TurnPhaseEvent` 또는 직접 호출 — 플로우 설계 시 결정 |
| I-2 | run 핸들 전달 | 현재 `BoardRenderProbe.runs`에 私유 — 우리 컴포넌트가 런 시작 시 핸들을 주입받을 공식 경로 필요 | `PlayerRunComponent:StartRun(job, run, def)` 시그니처 제안 |
| I-3 | 플레이어 말 표현 | **확정: 아바타 자체가 보드 말** (셀 스냅+조작 잠금). unit 레이어 occupantKind="player" 점유는 보드 소관 | 2026-07-05 사용자 확정 |
| I-4 | row 방향 의미 | **확정: 보드 작업자 기준을 따름** — facing↔(dcol,drow) 매핑은 `RotateOffset` 한 함수에 격리, 보드 축 의미가 확정되면 그 함수만 수정 | 2026-07-05 사용자 확정 |
| I-5 | OnUnitEnter 배선 | 재배치 시 보드가 `OnUnitEnter/Exit` 결과를 우리 `ApplyModifiers/RemoveBySource`에 넘기는 호출 지점 | 재배치 담당(보드) 코드에서 1줄 호출 |
| I-6 | 몬스터 HP/내성 | HitPlan 소비자(HP 차감·사망·EXP/전리품 드랍·속성 내성) 담당자 확정 | 미정 시 인터페이스 먼저 잠그고 목(mock) 소비자로 검증 |

## 8. 구현 순서 (검수 루프 적용)

1. ✅ **데이터셋 6종** + `SkillCatalogLogic` (2026-07-05 완료 — 테스트 스킬 8종)
2. ✅ **CombatResolveLogic** + `SkillInstanceLogic`(태그 시스템) (완료 — SelfTest 검증)
3. ✅ **PlayerStatComponent** + **SkillLoadoutComponent** (완료)
4. ✅ **PlayerGrowthComponent + PlayerJobComponent + PlayerRunComponent** + Events 7종 (완료)
5. 🔶 진입 배선 완료 — `GameStartLogic` + 로비 "게임 시작" 버튼(`ui/LobbyGroup.ui`) → `BoardRenderProbe.StartRunForUser` → `OnBoardReady` → `StartRun` (자동 입장 제거, 2026-07-05 사용자 결정). E2E 검증 PASS. **잔여: 젠/공격 페이즈 훅(I-1)은 보드 측 BoardFlowLogic 도입 시 `ResolveAttackPhase`/`OnTurnEnd` 호출 배선**
6. (후속) 캐릭터 UI(HUD/선택지 오버레이 — `ChoicePresentedEvent` 소비) · 동료 · 저장/이어하기

각 단계: lsp 0 에러 → `refresh` → `logs(build)` → `play` → `logs(runtime)` → `stop`, 완료 전 code-reviewer 검수.

## 9. 미해결 질문 (기획팀 전달용)

- 공격 슬롯 만석 시 새 공격 스킬 선택지 처리(교체 UI 자동 진입?) · 재추첨 상한/풀 제외 · 버프패시브 슬롯 상한 · 쿨다운/EXP 곡선 수치 · 속성 내성 테이블 · 상태이상 5종 효과 정의
- **다중 속성 태그 우선순위** (2026-07-05 확장성 검수): 한 스킬이 서로 다른 속성 태그를 여러 개 보유할 때 유효 속성 결정 규칙. 잠정 구현 = 최다 중첩 우선, 동률 시 나중에 얻은 태그. HitPlan에 `elementStacks`(중첩 수)를 실어 "같은 속성 중복 시 효과 강화"(사양서 §3-3 조건부) 구현 준비됨 — 강화 배율은 몬스터 측 소비 시 확정
- **rangeUp 태그의 비직선 패턴 정책**: 방향 무관 패턴(CROSS_4/AROUND_8)에는 현재 무효(경고 로그), 폭 2+ 방향 패턴(FRONT_FAN/WIDE)은 중심축 1칸만 연장. 46종 설계 시 (a) 패턴별 확장 규칙 데이터화, (b) 합성 시 무효 조합 차단, (c) 현행 유지+안내 중 택1 필요
- **재추첨 가능 범위**: 잠정 구현 = 마지막 합성/교체의 계승 태그만 재추첨 가능(이전 이식분은 영구 고정). 전체 이력 재추첨을 원하면 이력 배열로 확장 필요 — 기획 의도 확인
