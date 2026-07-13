# 몬스터 상세 사양서 (Dataset-Driven Monster)

> 상태: **초안 (draft, 2026-07-07) — 리뷰 전. 코드 착수는 이 사양 확정 후.** · 브랜치: `feature/monster-structure`
> 이 문서가 몬스터 구조의 단일 진실(SSOT). 보드 점유·배치 규칙은 [BOARD-SPEC.md](BOARD-SPEC.md)가 SSOT이며 이 문서는 그 계약을 소비만 한다(재정의 금지).
> 1차 범위 결정(2026-07-07): **정적 타겟** — 몬스터는 공격·이동하지 않는다. 스탯·행동 확장은 자리만 예약(§8).
> 행동 1단계 확정(2026-07-14): **턴이벤트 공격 파이프라인 구현** — `MonsterAct` 페이즈 + `EnemySkills` 데이터셋 + 계열 핸들러 + atkMin~Max 데미지 굴림·공격 연출까지. **플레이어 피해 적용만 로그 스텁**(전투/효과 사양 확정 시 그 지점만 교체, §8.1). 메이플 아일랜드 몬스터 8종 추가(총 9종).

---

## 0. 설계 목표 / 원칙

이 게임의 몬스터는 **보드 말(piece)** 이다. MSW 캐노니컬 액션 몬스터(AIChase·Rigidbody·물리 이동·ActionSheet 파이프라인)가 아니라, `BoardCell`처럼 칸에 스폰되는 경량 비주얼 + 서버 런타임 상태(HP)의 조합이다.

원칙 (BOARD-SPEC 원칙의 몬스터 적용):

1. **정적 정의 ↔ 휘발 인스턴스 분리.** "이 몬스터가 무엇인가"(HP·비주얼·예약 스탯)는 `MonsterTypes` 데이터셋(read-only), "지금 몇 마리가 어디서 얼마나 아픈가"는 `run.units`(런별 휘발). 절대 섞지 않는다.
2. **데이터셋 구동.** 몬스터 추가 = 데이터 1행(+리소스 RUID). 기존 config-dataset 패턴(CSV+JSON셀, `serveronly`, deep-copy 게터) 재사용.
3. **무상태 서비스.** 몬스터 API는 `run` 핸들을 인자로 받는다 — Logic 전역 상태 금지(런 간 누수 방지, BoardService·BoardFlowLogic과 동일 패턴).
4. **보드 계약 존중.** 몬스터의 위치 진실은 `run.board`의 unit 레이어 점유(BOARD-SPEC §4.2)다. 몬스터 시스템은 `TryOccupy`/`Release`를 통해서만 점유를 만지고, 좌표·배치 해석(`ResolvePlacement`)을 재구현하지 않는다.
5. **1차 = 정적 타겟.** 몬스터는 스폰 → 서 있음 → 맞음 → 죽음의 4상태뿐. 행동(공격/이동)은 기획 확정 후 별도 페이즈로 추가(§8.1).

---

## 1. 3계층 아키텍처 (BOARD-SPEC §2 미러)

| 계층 | 역할 | 모델 |
|---|---|---|
| **① MonsterTypes·DropTables 데이터셋** | 몬스터 카탈로그(식별자·HP·비주얼·예약 스탯) + 사망 드랍 테이블(§2.5) | CSV + JSON셀, `serveronly` |
| **② 카탈로그 (로더)** | 데이터셋 → 불변 `MonsterDef`/`DropTableDef` 파싱·검증·캐시 | `BoardCatalogLogic`에 `GetMonsterType`·`GetDropTable` 추가 (기존 Object/Aura/Item 게터와 나란히) |
| **③ MonsterService (런타임)** | 스폰(비주얼+점유+등록)·피해·사망·질의 | 무상태 `@Logic`, 상태는 `run.units`에만 |

> **② 배치 결정:** 별도 `MonsterCatalogLogic`을 신설하지 않고 `BoardCatalogLogic`을 확장한다. 이유: (a) `wavePlacements.occupantId` 적재 시 검증(§5)이 StageDef 빌드 경로 안에 있어야 하고, (b) Object/Aura/Item과 동일한 "타입 카탈로그" 성격이라 로더 헬퍼(`ParseJsonCell`/`ToBool`/`DeepCopy`)를 그대로 공유한다. 전투 확장(태그·내성·행동)으로 카탈로그가 비대해지면 그때 분리를 검토(§8).

---

## 2. 데이터셋 스키마: `MonsterTypes` (`RootDesk/MyDesk/Zengard/Data/`)

> 스칼라 = CSV 컬럼, 중첩 = JSON 텍스트 셀. `serveronly=true`.

| 컬럼 | 예시 | 형식 | 1차 사용 | 설명 |
|---|---|---|:---:|---|
| `monsterId` | `orangemushroom` | 스칼라 | ✅ | 식별자. `wavePlacements`/`initialPlacements`의 `occupantId`가 참조 |
| `name` | `주황버섯` | 스칼라 | ✅ | 표시명(후일 UI·로그) |
| `maxHp` | `100` | 스칼라(number) | ✅ | 최대 HP. 스폰 시 `run.units[].hp` 초기값 |
| `model` | (빈값) / `BossShell` | 스칼라 | ✅ | 비주얼 모델 오버라이드. **빈값 = 공용 `BoardUnit` 모델**(§4). 보스 등 특수 형태만 지정 |
| `packId` | `mob/1210102.img` | 스칼라 | ✅(저작) | 출처 리소스 팩 id. 런타임 소비 없음 — 클립 추가 확보·재검증 시 추적용(리소스 검색 API는 저작 시점 전용) |
| `clips` | `{"stand":"a95c…","hit":"5ebb…","die":"dddb…","move":"8257…"}` | JSON | ✅ | 상태별 animationclip RUID. 키는 정규화 어휘 `stand/move/hit/die/attack/skill`(MSW 몹 팩의 `stand/move/jump/hit1/die1/attack1/skill1`에서 매핑). **`stand`만 필수**(비주얼 폴리시 — 빈값·누락 시 적재 경고), 1차 소비도 `stand`뿐. `hit`/`die`는 §8.3 연출 확장 시 소비 |
| `sounds` | `{"hit":"6eb2…","die":"c496…"}` | JSON | 예약 | 피격/사망음 RUID(팩의 `_audio/Damage`·`_audio/Die`). 데이터는 지금 채우되 소비는 §8.3 연출 확장 시 |
| `dropTableId` | `mushroomTier` | 스칼라 | ✅ | 사망 드랍 테이블 참조(§2.5 `DropTables`). **빈값 = 드랍 없음.** 적재 시 존재 검증 |
| `atkMin` / `atkMax` | `12` / `17` | 스칼라(number)×2 | ✅ | 몬스터 공격력 범위(2026-07-14 `atk` 스칼라에서 확장 — 옛메 몬스터 공격력이 Min~Max 범위 소유). `basic_attack` 발동 시 이 범위로 데미지 굴림(§8.1). 적재 시 `atkMax < atkMin`이면 클램프+경고 |
| `turnEvents` | `[{"when":{"every":3},"skillId":"basic_attack"}]` | JSON | ✅ | 턴 트리거 스킬 스케줄. `when`은 객체(`{"turn":N}` / `{"every":N}` / 후일 `{"hpBelow":0.5}` 등 확장). **스케줄은 마나 게이지가 소비**(2026-07-09, §8.3): 첫 엔트리의 N = `manaMax`, 1턴(라운드)당 마나 +1 → 가득 = `turnEventReady` 마킹(`every`는 발동 후 0부터 재충전, `turn`은 1회성). **발동 구현됨(2026-07-14, §8.1)**: `skillId` → `EnemySkills` 데이터셋 참조(적재 시 존재 검증), `MonsterAct` 페이즈가 ready 유닛을 발동 |
| `tags` | `["boss"]` | JSON | 예약 | 분류 태그(스킬 태그 시스템과 별개 — 몬스터 분류용). 1차 미사용 |
| `resists` | `{"fire":0.5}` | JSON | 예약 | 속성 내성(기획 미확정 — 속성 6종). 1차 미사용 |
| `statusImmune` | `["stun"]` | JSON | 예약 | 상태이상 면역(기획 미확정 — 5종). 1차 미사용 |

- **예약 컬럼 정책:** 컬럼은 지금 만들되(마이그레이션 회피) 로더가 파싱만 하고 소비처는 없다. 예약 컬럼의 *의미 확정*은 기획서(속성·상태이상·몬스터 행동) 확정과 함께 — 그 전에 소비 코드를 작성하지 않는다.
- **`occupantKind`와의 관계:** `monster` vs `boss` 구분(BOARD-SPEC §4.2 kind 집합)은 배치 데이터의 `occupantKind`가 소유. MonsterTypes는 kind를 갖지 않는다 — 같은 몬스터를 일반/보스 웨이브 양쪽에 쓸 수 있게 분리 유지.

### 초기 데이터 — 메이플 아일랜드 9종 (2026-07-14 확장)

외부 몬스터 목록(카톡 수신 이미지 `KakaoTalk_20260713_231126079.png` — HP/공격력 Min~Max 표)에서 스탯을 적재하고, `msw-search`로 각 팩의 클립/사운드 RUID를 확보. 전체 행은 `MonsterTypes.csv` 참조.

| monsterId | 이름 | HP | atk | 팩 | dropTableId | 비고 |
|---|---|--:|:--|---|---|---|
| `snail` | 달팽이 | 8 | 1~2 | `mob/0100100.img` | islandTier1 | attack 클립 보유 |
| `bluesnail` | 파란 달팽이 | 15 | 2~3 | `mob/0100101.img` | islandTier1 | attack 클립 보유 |
| `spore` | 스포아 | 20 | 3~4 | `mob/0120100.img` | islandTier1 | |
| `redsnail` | 빨간 달팽이 | 40 | 5~7 | `mob/0130101.img` | islandTier2 | attack 클립 보유 |
| `stump` | 스텀프 | 45 | 5~8 | `mob/0130100.img` | islandTier2 | |
| `slime` | 슬라임 | 50 | 7~10 | `mob/0210100.img` | islandTier2 | |
| `pig` | 돼지 | 75 | 10~14 | `mob/1210100.img` | islandTier3 | |
| `orangemushroom` | 주황버섯 | 90 | 12~17 | `mob/1210102.img` | mushroomTier | 기존 행 — HP 100→90 표 반영 |
| `ribbonpig` | 리본돼지 | 120 | 16~22 | `mob/1210101.img` | islandTier3 | |

- 이미지의 `빅뱅 전/후`·`대표 출몰 맵` 컬럼은 미사용(현 구조에 소비처 없음 — 스테이지 구성은 StageDefs 소유).
- `turnEvents`는 전 몬스터 `[{"when":{"every":3},"skillId":"basic_attack"}]`(기본값 — CSV에서 개별 튜닝).
- 스테이지 배치는 무변경(stage01 = 주황버섯) — 신규 몬스터의 웨이브 편성은 스테이지 기획과 함께.

> RUID는 반드시 `msw-search`로 확보한 실물만 적재(placeholder 금지) — 빈/가짜 RUID는 "보이지 않는 몬스터" 무증상 실패를 만든다. 참고: 보스급 팩(예: 머쉬맘 `mob/6130101.img`)은 `attack1`/`skill1` 클립과 `_audio/Attack1`/`_audio/Skill1`을 추가 제공 — `clips.attack`/`clips.skill` 키로 수용.

### 2.5 데이터셋 스키마: `DropTables` (사망 드랍, 2026-07-07 확정)

몬스터 사망 시 아이템 추첨 테이블. **테이블은 티어 단위 공유**(버섯류 N종이 같은 테이블 참조)가 전제라 MonsterTypes 인라인이 아닌 별도 데이터셋. `serveronly=true`.

| 컬럼 | 형식 | 설명 |
|---|---|---|
| `dropTableId` | 스칼라 | 식별자. `MonsterTypes.dropTableId`가 참조 |
| `entries` | JSON | 가중치 추첨 리스트. 엔트리 = `{kind, id, weight, min?, max?}`. `kind`/`id` 없는 엔트리 = "꽝"(드랍 없음). 가중치 합 100 불필요 — 정규화 추첨 |

**`kind` 다형 참조 — 아이템 대분류는 소비 시스템 소유 기준으로 데이터셋 분리** (단일 메가 테이블 금지 — 스키마 유니온 블롭 방지):

| kind | 카탈로그 | 소유 시스템 | 획득 경로 (혼합 모델, 2026-07-07 확정) | 시점 |
|---|---|---|---|---|
| `boardItem` | `ItemTypes` (기존 — 보드 칸 버프 픽업 전용으로 유지) | 보드 Item 레이어 | **보드 낙하**: 죽은 칸에 배치 → 유닛이 밟으면 픽업(기존 계약 그대로) | ✅ 1차 |
| `loot` | `LootTypes` (미신설 — 전리품: 재화/재료) | 보상/재화 시스템 | **즉시 적립**: 킬 시 런 보상 풀 → Result 정산 | 보상 시스템 사양 확정 시(§8.7) |
| `equip` | `EquipTypes` (미신설 — 장비: 슬롯3·레어도4단·태그, 5차 기획서 확정분 기반) | 인벤토리/장비 시스템 | **즉시 적립**: 동일 | 장비 시스템 사양 확정 시(§8.7) |

- **획득 경로가 kind에 붙는다** — 드랍 테이블은 "무엇이 나오는가"만 정의하고, 나온 것의 전달은 kind별 소유 시스템이 담당. 보드 계약(Item 레이어 payload — BOARD-SPEC §4.2)은 무변경.
- **적재 시 검증:** ① `MonsterTypes.dropTableId` → DropTables 존재 ② entries의 `kind="boardItem"` → `id`가 ItemTypes에 존재(§5 occupantId 검증과 동일 패턴). `loot`/`equip`은 카탈로그 신설 전까지 `log_warning`만.
- **배치 실패 정책(1차):** `boardItem` 낙하 시 죽은 칸의 `CanPlaceItem` 실패(이미 아이템 존재 등) → **드랍 소실 + 경고 로그**. 인접 빈칸 탐색은 확장 예약(§8.7).
- 참고: msw-packages의 DropTable 패키지는 액션 게임 필드 드랍(월드 엔티티+물리 픽업)용 — 그리드 점유 모델과 런타임이 달라 부적합(미채택 결정).

#### 초기 데이터 (1차)

```csv
dropTableId,entries
mushroomTier,"[{""kind"":""boardItem"",""id"":""atkPotion"",""weight"":30},{""weight"":70}]"
```

메이플 아일랜드 티어 테이블(2026-07-14 — 소액 메소 loot, 드랍 기획 확정 전 기본값):

```csv
islandTier1,"[{""kind"":""loot"",""id"":""meso"",""weight"":40,""min"":3,""max"":8},{""weight"":60}]"
islandTier2,"[{""kind"":""loot"",""id"":""meso"",""weight"":50,""min"":10,""max"":25},{""weight"":50}]"
islandTier3,"[{""kind"":""loot"",""id"":""meso"",""weight"":55,""min"":25,""max"":60},{""weight"":45}]"
```

---

## 3. 런타임 구조: `run.units` (휘발, 유닛 인스턴스 레지스트리)

보드 점유 레코드(`rec.unit = {occupantId, instanceId, occupantKind}`)는 **위치의 진실**만 갖는다(BOARD-SPEC §4.2 — 변경 없음). HP 등 인스턴스 상태를 셀 레코드에 넣으면 이동 시 상태가 딸려다니고 전 셀 스캔 없이 몬스터를 못 찾으므로, **인스턴스 상태는 별도 레지스트리**로 둔다:

```lua
run.units = {
  [instanceId] = {           -- 키 = TryOccupy가 발급한 instanceId (전 레이어 공통 핸들 재사용)
    instanceId,              -- 자기 키(순회 편의)
    occupantId,              -- MonsterTypes.monsterId (player면 userId)
    kind,                    -- "monster" | "player" | "boss" (BOARD-SPEC kind 집합)
    col, row,                -- 현재 칸 (rec.unit과 이중 기록 — 갱신은 §5 이동 API 전담)
    hp, maxHp,               -- 몬스터만. player HP는 효과/전투 시스템 소유(여기 두지 않음)
    mana, manaMax,           -- 턴이벤트 충전량(§2 turnEvents 첫 엔트리의 N). 턴이벤트 없으면 nil(마나바 숨김)
    turnEvent,               -- {mode="every"|"turn", skillId} — 도달 판정용(발동은 §8.1 예약)
    entityRef,               -- 스폰된 비주얼 엔티티 핸들 (사망/정리 시 Destroy)
    gaugeRef, gaugeComp,     -- HP/마나 게이지 엔티티(slot 자식 UnitGauge)와 script.UnitGauge 핸들
    alive,                   -- true/false (사망 마킹 — Release 이후에도 late-kill 판별용)
  },
}
```

- **단일 진실 규칙:** 위치 갱신(스폰·이동·사망)은 반드시 MonsterService API를 통한다. `rec.unit`·`run.units[].col/row`·`entityRef` 위치가 서로 어긋나는 순간이 없도록 한 함수 안에서 원자적으로 처리.
- **player도 등록:** Init 페이즈의 플레이어 착석(FSM TODO)도 `run.units`에 `kind="player"`로 등록한다 — `GetUnitAt`/`GetUnitsByKind` 질의를 몬스터·플레이어 공용으로 쓰기 위함. 단 player의 `hp`는 nil(전투 시스템 소유).
- `run.units`는 `BoardRenderProbe.BuildBoard`의 run 셋업에서 `{}`로 초기화.

---

## 4. 비주얼 모델: 공용 `BoardUnit.model` + RUID 데이터 주입

**전략: 모델 1개 + 데이터 주입** (몬스터별 `.model` 양산 금지).

- `RootDesk/MyDesk/Models/Monsters/BoardUnit.model` — **프리팹 구조(2026-07-10 개편)**: `Root(Transform만)` > `Body(Transform+SpriteRenderer — 클립 재생 대상, SortingLayer `BoardUnit`/Order 0)` + `Gauge(Transform+PixelRenderer+script.UnitGauge — HP/마나 바, local y+0.45, SortingLayer `BoardOverlay`/Order 10)`. 한 번의 `SpawnByModelId`로 전체 구성이 인스턴스화되고, 파괴는 루트 1개로 연쇄. **Body 없음(물리)** — 보드 말은 물리 이동하지 않고 slot 자식으로 배치되므로 `KinematicbodyComponent` 불필요.
  - 뎁스는 BOARD-SPEC §1.5의 SortingLayer 밴드 체계(SSOT)를 따른다(2026-07-11 확정). 초기의 "Default 레이어 + Order 1000" 방식은 animationclip 재생 스프라이트에 밀리는 실측(2026-07-10)으로 폐기 — 전용 레이어 분리로 대체됨.
  - 스폰 시 `MonsterService`가 `GetChildByName("Body"/"Gauge")`로 자식을 해석해 `run.units[].bodyRef/gaugeRef/gaugeComp`에 보관. 클립 주입·연출(§8.3)은 전부 Body 대상.
- 스폰 직후 서버가 Body의 `SpriteRUID = monsterDef.clips.stand` 주입(animationclip이라 자동 루프 재생).
- `MonsterTypes.model`이 지정된 경우에만 해당 모델로 오버라이드(보스 등) — **오버라이드 모델도 동일 프리팹 규약(Root > Body/Gauge 자식명)을 따라야 한다**(위반 시 스폰 경고 로그 + 연출/게이지 생략).
- 위치 규약은 BoardService 기존 규약 그대로: **칸 slot의 자식, local `(0, 0, -0.05)`** (셀보다 앞). z-오더 세부는 구현 시 오브젝트/아이템 비주얼과 함께 검증.
- 몬스터 추가 = MonsterTypes 1행 + 리소스 팩 1개에서 확보한 클립 RUID 세트(`clips`/`sounds`). 맵·모델 에셋 추가 불필요(보드 §1.5 철학과 동일).

> HP 게이지·피격 플래시·사망 연출은 §8 확장. 1차는 사망 시 즉시 Destroy로 충분(연출 없음).

---

## 5. MonsterService API (무상태 `@Logic`, ServerOnly)

```
-- 스폰 (WaveGen/initialPlacements의 unit 점유와 짝)
SpawnMonster(run, def, col, row, occupantId, occupantKind) → instanceId | nil
   -- TryOccupy(...,"unit",...) 성공 시: MonsterDef 조회 → 비주얼 스폰(slot 자식, RUID 주입)
   --   → run.units 등록. 어느 단계든 실패 시 점유 롤백(Release) + 경고 후 nil.
   -- BoardService.SpawnLayerVisual의 unit 분기(현 placeholder "BoardCell")를 이 함수 호출로 대체.

-- 피해 / 사망 (1차 데미지 진입점 — 데미지 '공식'은 전투/효과 사양 소유, 여기는 적용만)
ApplyDamage(run, instanceId, amount) → 남은 hp | nil
   -- run.units 조회(없거나 !alive면 nil — late-kill 보호). hp -= amount.
   -- hp <= 0 → KillUnit 즉시 호출(1차: 연출 없이 동기 처리).
KillUnit(run, instanceId)
   -- alive=false → Release(board, col, row, "unit", instanceId) → entityRef Destroy → run.units에서 제거는
   --   하지 않고 alive=false 마킹 유지(같은 라운드 내 중복 참조 보호). 라운드 경계(PostAttack)에서 sweep 제거.
   -- 사망 드랍(kind="monster"|"boss"만): dropTableId 있으면 정규화 가중치 추첨(서버 RandomDouble).
   --   당첨 kind="boardItem" → 죽은 칸 (col,row)에 기존 item 배치 경로 재사용(TryOccupy "item" + 비주얼)
   --     — CanPlaceItem/픽업을 재구현하지 않는다. 배치 실패 → 소실 + 경고 로그(§2.5).
   --   당첨 kind="loot"/"equip" → 런 보상 풀 적립(§8.7 확정 전까지 log만 남기고 skip).

-- 턴 경과 (PostAttack이 소비 — 2026-07-09 추가, 2026-07-14 충전/발동 분리)
TickTurn(run) → 틱한 유닛 수
   -- alive 몬스터/보스 중 manaMax>0 유닛의 mana +1. 가득 = turnEventReady 마킹까지만(발동·리셋 없음).
   --   게이지 @Sync 갱신 포함. 충전(상태)은 여기, 발동(페이즈·연출 순서)은 ActTurnEvents 소유(§8.1).
ActTurnEvents(run) → 발동한 유닛 수 (MonsterAct 페이즈가 소비 — 2026-07-14 추가)
   -- turnEventReady 유닛 순회 → GetEnemySkill(skillId) → _EnemySkillService:Execute(run, unit, skillDef).
   --   성공: every = 마나 0 리셋 / turn = turnEventDone 마킹. 실행 실패: ready 유지(다음 라운드 재시도).
   --   스킬 데이터 결함(카탈로그 미존재): 경고 + 이벤트 영구 비활성(재시도 무의미).
PlayAttackFx(unit)
   -- 공격 연출(§8.1): Body에 clips.attack 재생 후 stand 복귀(hitSeq 토큰 공유 — 피격 연출과 경합 보호).
   --   attack 클립 없는 몬스터는 조용히 생략.
UpdateGauge(unit)
   -- run.units 상태(hp/maxHp/mana/manaMax) → script.UnitGauge @Sync 반영. 페인트는 클라(§8.3).

-- 질의 (Attack/PostAttack/DecideNext가 소비)
GetUnitAt(run, col, row) → unit | nil          -- rec.unit.instanceId → run.units 해석
GetUnitsByKind(run, kind) → unit[]              -- alive만
CountAlive(run, kind) → integer                 -- DecideNext 승패 판정용
```

- **책임 경계:** 몇 데미지인지(ATK×계수, Modifier 집계, 크리)는 스킬/효과 시스템이 계산해서 `amount`로 넘긴다. MonsterService는 HP 차감·사망·정리만 소유. — BOARD-SPEC §8이 효과 엔진에 그은 선과 동일한 패턴.
- **적재 시 검증(카탈로그 쪽):** `BuildStageDef`/`BuildBoardDef`가 unit 배치 스펙을 검증할 때 `occupantId`가 MonsterTypes에 존재하는지 확인(미존재 → `log_error`, 해당 스펙 제외). 현재 `orangemushroom` 문자열이 무검증 통과하는 구멍을 막는다.

### 5.5 엘리트 몬스터 + 검은 구슬 (2026-07-12 확정)

**설정은 스테이지(맵) 데이터 소유** — StageDefs 컬럼 2개(BOARD-SPEC §3.6):

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `eliteCount` | `1` | 이 스테이지에서 엘리트로 승격되는 몬스터 **상한**(개수 제한). 0 = 엘리트 없음 |
| `blackOrbRate` | `0.2` | **일반 몬스터**의 검은 구슬 드랍률(0~1, 적재 시 클램프). **엘리트는 확정(1.0)** |

- **승격 규칙(`TryPromoteElite`):** 스폰 시점에 "남은 엘리트 수 ÷ 남은 몬스터 수" 확률로 판정 —
  스폰 순서와 무관한 균등 배정이며 몬스터 총수 ≥ eliteCount면 상한을 정확히 채운다.
  모수(`totalMonsters`)는 BuildStageDef가 initial+wave 배치의 `monster` kind 수를 합산해 계산(**boss 제외** — 보스는 승격 대상 아님).
  런 상태는 `run.eliteRemaining`/`run.monsterRemaining`(BoardRenderProbe 셋업), 유닛 마킹은 `run.units[].elite`.
- **엘리트 비주얼:** 승격 시 `EliteAura.model`(스킬 이펙트 animationclip 루프, `BoardProp`/Order 25 —
  아이템 위·유닛 밴드 아래 바닥 오라)을 **유닛 루트 자식**으로 스폰 — 사망/파괴 시 연쇄 정리(별도 관리 불필요).
- **검은 구슬 드랍(`RollBlackOrb`):** KillUnit에서 **드랍 테이블과 독립**으로 굴리는 추가 롤(둘 다 나올 수 있음) —
  "모든 몬스터(monster/boss)가 드랍 가능, 확률은 맵 소유, 엘리트는 확정"을 DropTables 스키마 왜곡 없이 표현.
  획득물 `blackOrb`는 LootTypes 일반 전리품(rare) — 자석 연출/인벤 파이프 그대로 재사용.
- **스탯 변화 없음(1차):** 엘리트는 비주얼+확정 드랍만. HP/ATK 배율 등 강화는 기획 확정 시 확장(§8.2와 함께).

---

## 6. FSM 연동 (BoardFlowLogic — 기존 페이즈에 꽂기, 신규 페이즈 없음)

| 페이즈 | 몬스터 관련 동작 (1차) |
|---|---|
| `Init` | (변경 없음) 플레이어 착석 시 `run.units`에 player 등록만 추가 |
| `WaveGen` | `ApplyWavePlacements` → unit 스펙이 `SpawnMonster` 경로로 흐름(§5). 웨이브 소진 판정용으로 `run.maxWave`(stageDef의 최대 wave 번호)를 카탈로그가 계산해 둔다 |
| `Attack` | (전투 사양 소유) 스킬 판정 결과가 `ApplyDamage(run, instanceId, amount)` 호출 → `MonsterAct`로 전이 |
| `MonsterAct` | **(2026-07-14 신설, §8.1)** `ActTurnEvents` — 이전 라운드에 `turnEventReady`로 마킹된 유닛의 스킬 발동(플레이어 공격 다음, 사망 정리 전) |
| `PostAttack` | `TickTurn`(마나/턴이벤트 충전 + ready 마킹, 1라운드=1턴) → 사망 sweep(`alive=false` 유닛을 `run.units`에서 제거) → `DecideNext` |
| `DecideNext` | 승리: `CountAlive(run,"monster")==0 ∧ run.wave >= run.maxWave` → Result. 패배 조건(플레이어 사망)은 전투 사양 확정 후. 그 외 계속 |
| `Result` | `DestroyBoard` 정리에 몬스터 비주얼 포함(slot 자식이라 slot 파괴로 연쇄 — 별도 순회 불필요, 구현 시 확인) |

> **몬스터 행동 페이즈 없음(1차 확정).** 몬스터가 공격/이동하게 되면 `PostAttack` 앞에 `MonsterAct` 페이즈를 신설하는 것이 자리(§8.1) — 기존 페이즈에 끼워넣지 않는다.

---

## 7. 검증 계획

1. **SelfTest(카탈로그):** `GetMonsterType("orangemushroom")` 로드·deep-copy 격리·`clips` JSON 파싱·`clips.stand` 누락 경고 확인. `GetDropTable("mushroomTier")` 로드 + 참조 검증(존재하지 않는 `dropTableId`/`boardItem` `id` → 경고) 확인.
2. **SelfTest(서비스):** 더미 run으로 Spawn→ApplyDamage→Kill 흐름 — 점유 발생/해제, `run.units` 정합, late-kill(죽은 instanceId 재타격) 무시 확인. Kill 시 드랍: 추첨 분포(당첨/꽝), `boardItem` 당첨 시 item 점유 발생, 죽은 칸에 이미 아이템이 있을 때 소실+경고 확인.
3. **인엔진:** `refresh` → `play` → 입장 → wave1에서 주황버섯 3마리가 spawnTop 존에 **보이는지**(RUID 주입 검증) → `maker_execute_script`로 `ApplyDamage` 강제 호출 → 사망 시 비주얼 제거+점유 해제 로그 + (추첨 당첨 시) 죽은 칸에 아이템 비주얼 등장 확인 → `stop`.

---

## 8. 확장 예약 / Deferred

- **8.1 몬스터 행동(공격·이동):** 🔶 **공격 파이프라인 구현됨(2026-07-14)** — `MonsterAct` 페이즈 신설(Attack↔PostAttack 사이), `EnemySkills` 데이터셋 신설(`Zengard/Data/`, `{skillId,name,family,params}` — 초기 행 `basic_attack`/family `basic`), `atkMin`·`atkMax`·`turnEvents` 소비, 디스패처 `Monster/EnemySkillService.mlua` + 계열 핸들러 `Monster/Skills/BasicSkillLogic.mlua`, 공격 연출 `PlayAttackFx`(clips.attack). **남은 스텁: 플레이어 피해 적용** — `BasicSkillLogic.BasicAttack`이 데미지를 굴린 뒤 로그만 남긴다(플레이어 HP·패배 판정은 전투/효과 사양 소유 — 확정 시 그 지점만 교체). 몬스터 *이동*은 여전히 미구현(기획 미확정). 스케줄(MonsterTypes.turnEvents) ↔ 정의(EnemySkills) 분리 결정: 2026-07-07.
  - **구현 구조(2026-07-09 확정, 2026-07-14 코드 반영):** 스킬 구현은 몬스터별도, 추상 행동별도 아닌 **몬스터 계열(family: 버섯/골렘/…)별 분리**. 몬스터마다 전부 다르게 구현하면 스킬 수가 폭발하므로 계열이 구현 단위 — 같은 계열 안에서 스킬 여러 개 확장 가능.
    1. *데이터*: `EnemySkills` 행 = `{skillId, name, family, params(JSON)}`. family = 계열(핸들러 라우팅 키, 스킬 행이 소유 — MonsterTypes 컬럼 추가 불필요), params = 스킬별 자유 스키마. 확장 3축: 같은 스킬 다른 수치 = 데이터 1행(params) · 계열에 새 스킬 = 계열 파일에 메서드 1개 + 데이터 1행 · 새 계열 = 파일 1개 + 라우팅 1줄.
    2. *카탈로그*: `BoardCatalogLogic.GetEnemySkill` — 기존 게터 패턴(파싱·캐시·deep-copy). 적재 시 ① turnEvents.skillId → EnemySkills 존재 ② family → 핸들러 레지스트리 존재(`_EnemySkillService:HasFamily`) 이중 검증.
    3. *실행*: `Monster/EnemySkillService.mlua`(디스패처 — family→핸들러 라우팅 테이블 + 공통 로그만, 구현 없음) + `Monster/Skills/{Family}SkillLogic.mlua`(계열당 파일 1개, 공통 계약 `Execute(run, unit, skillDef) → boolean`, 계열 내부는 skillId 분기 + 계열 공통 헬퍼 공유). 여러 계열이 같은 패턴을 반복하게 되면 그때 공용 헬퍼로 추출(선제 일반화 금지).
    4. *발동 시점*: `TickTurn`(PostAttack)은 마나 충전 + `turnEventReady` 마킹까지만. 발동은 `MonsterAct` 페이즈(Attack↔PostAttack 사이 신설)가 ready 유닛 순회 → `Execute` 성공 시 마나 리셋 — 충전(상태) ↔ 발동(페이즈·연출 순서) 소유 분리.
    5. *경계*: 핸들러는 보드/몬스터 API(`TryOccupy`/`SpawnMonster`/`ApplyDamage`) 호출만. 데미지 공식·플레이어 피해는 전투/효과 사양 소유(확정 전 stub), 점유·좌표 해석 재구현 금지.
- **8.2 속성 내성 / 상태이상 / 태그:** 기획서 미확정분. 예약 컬럼(§2)만 존재.
- **8.3 HP 게이지·피격/사망 연출:** ✅ **전체 구현됨.** ① HP/마나 게이지(2026-07-09) — `Models/Monsters/UnitGauge.model`(Transform+PixelRenderer+`script.UnitGauge`)을 slot 자식(local y+0.45)으로 스폰, 16×5 픽셀 그리드에 위 2줄 HP(색상 3단계)·아래 2줄 마나(파랑, `manaMax=0`이면 숨김). 서버 `UpdateGauge`가 @Sync 갱신 → 클라 `OnSyncProperty` 페인트(Lazy Init). ② 피격/사망 연출(2026-07-10) — `run.units`에 `clips`/`sounds` 적재, `ApplyDamage` 생존 시 `PlayHitFx`(hit 클립 `HitFxDuration`=0.45s 후 stand 복귀, hitSeq 토큰으로 재피격/사망 경합 보호 + `sounds.hit`), `KillUnit`은 점유/드랍/게이지 즉시 정리 후 die 클립 재생 + `sounds.die` → `DieFxDuration`=0.8s 지연 파괴(레지스트리에선 entityRef 즉시 분리 — 타이머는 로컬 레퍼런스만). 클립 없는 몬스터는 조용히 생략(기존 즉시 파괴).
- **8.4 보스:** `occupantKind="boss"` + `place:"center"`는 보드가 이미 지원. 멀티셀 점유·전용 모델·페이즈 패턴은 별도 사양.
- **8.5 소환수(플레이어 측 유닛):** `run.units` kind 확장으로 수용 가능 — 기획 확정 후.
- **8.6 효과 엔진 연동:** 몬스터가 받는 Modifier(오라 위 몬스터 등)는 효과 시스템 사양(BOARD-SPEC §9 deferred)과 함께. `OnUnitEnter` 훅 호출 시점 미확정 이슈(BOARD-SPEC §7 ⚠️)도 그때 함께 확정.
- **8.7 드랍 확장 — `loot`/`equip` kind + 보상 풀:** `LootTypes`(전리품: 재화/재료)는 보상/재화 시스템 사양과 함께, `EquipTypes`(장비: 슬롯3·레어도4단·태그 — 5차 기획서 확정분 기반)는 인벤토리/장비 시스템 사양과 함께 신설. 그때까지 DropTables의 해당 kind 엔트리는 적재 경고 + KillUnit에서 log-skip. "런 보상 풀 → Result 정산" 파이프도 그때 확정. 추가 확장: `boardItem` 배치 실패 시 인접 빈칸 탐색(1차는 소실).

---

## 9. 미확정 게이트 (기획 확인 필요)

1. 몬스터 행동 유무·방식 (→ §8.1) — **이 사양의 1차 구현은 게이트와 무관하게 진행 가능.**
2. 패배 조건(플레이어 HP·사망) — 전투/효과 사양 소유.
3. 속성·상태이상 의미 확정 (→ §8.2).
