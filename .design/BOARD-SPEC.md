# 보드 상세 사양서 (Dataset-Driven Board)

> 상태: **리뷰 완료 (critic ACCEPT, 2026-06-30) — 게이트 2건 해소(맵 §1.5·효과공유 §3.0) + 전체 정합성 리뷰 통과. 코드 착수 가능.** · 브랜치: `feature/ingame-board`
> 남은 별개 게이트: ~~①§1.5 인엔진 렌더 검증~~ **✅ 해소(2026-06-30, BoardRenderProbe PoC)** ②§9 효과엔진 본체 사양(별도 개발 중) — 보드 구현과 분리 진행 가능.
> 이 문서가 보드 구현의 단일 진실(SSOT). 코드 착수는 이 사양 확정 후.
> 참고: 이전 보드(`feature/ingame-runkit`)는 **구조 참고용**일 뿐, 현재 코드 기준 아님.

---

## 0. 설계 목표 / 원칙

현행 보드(runkit 참고)의 한계: `BoardConfig`가 **코드 리터럴**(7×7 고정)이고, 셀이 **점유 여부만** 안다. 다양한 기능을 얹으려면 보드가 **데이터로 정의**되고 셀이 **속성·다층 점유**를 가져야 한다.

원칙:
1. **정적 정의(데이터) ↔ 휘발 점유(run) 분리.** "보드 생김새·규칙"은 데이터(런 무관, read-only), "누가 어디 있나"는 `run.board`(런별 휘발). 절대 섞지 않는다.
2. **데이터셋 구동.** 격자 크기·셀타입·영역·초기배치 전부 데이터셋에서 로드. 기존 config-dataset 패턴(`JsonUtil` 로더 + `serveronly` 데이터셋 + deep-copy 게터) 재사용.
3. **무상태 서비스.** 점유 API는 `board` 핸들을 인자로 받는다 → N개 런이 한 격자를 공유하지 않음(멀티 대비 구조 보존, 싱글 우선 검증).
4. **레이어드 점유.** 한 칸은 여러 레이어(바닥/오라/오브젝트/아이템/유닛)를 동시에 가질 수 있다.

---

## 1. 좌표계 / 지오메트리

- **0-기반 좌표**: `col ∈ [0, cols-1]`, `row ∈ [0, rows-1]`.
- **NxM 가변 격자**: `cols`/`rows`는 레이아웃 데이터로 결정 (정사각 NxN 아님, 확장성 위해 NxM).
- 셀↔월드 변환은 **단일 출처**(`CellToWorld`/`WorldToCell`)만 사용. `cols`/`rows`/`cellSize`/`center`는 상수가 아니라 **`BoardDef`(데이터)** 에서 읽는다 (현행 `_BoardConfig.GRID_COLS` 상수 → `def.cols`로 대체).
- 유사 깊이(아래 행이 앞), `originOffset`(co-located 보드 월드충돌 회피 + 보드 전체 화면 오프셋)는 현행 구조 유지. **2026-07-09부터 originOffset은 슬롯별 가산이 아니라 `Board` 루트 앵커의 위치로 적용**(§1.5 하이어라키) — 보드 전체 이동 = 루트 1개 이동. 기본값은 `BoardRenderProbe.BoardOrigin = (0, 1, 0)`.
- 셀→루트-로컬 변환은 `CellToLocal`(slot 스폰용), 셀→월드는 `CellToWorld = CellToLocal + originOffset`(질의용). `WorldToCell`은 originOffset 차감으로 대칭.

---

## 1.5 맵 / 시각화 모델 (확정: 런타임 스폰 — 옛 D7 박제 폐기)

런 격리는 **단일 기본 템플릿 맵 `BoardMap`(앵커만 박제, 셀 없음)** 을 `CreateDynamicMap`으로 복제하는 구조를 유지한다. 단, 셀·보드·몬스터·웨이브는 **복제 후 런타임에 스테이지 데이터로 세팅**한다 (옛 D7의 "7×7 셀 박제" 폐기 — 가변 NxM/void/레이아웃별 cellSize를 단일 정적 맵으로 표현 불가하므로).

**스테이지 입장 시퀀스:**
1. `CreateDynamicMap('BoardMap', 'BoardMap_'+runId)` — 빈 템플릿 복제 (기존 RunRegistry/D1/D3 경로 유지)
2. 플레이어를 복제맵으로 텔레포트
3. **런타임 세팅 (스테이지 데이터 구동):**
   - a. `BuildBoard(run, def)` — `BoardDef`(NxM/void/cellSize) 읽어 **비-void 칸마다 `BoardCell.model` 스폰**·`CellToWorld` 배치 + 배경
   - b. `initialPlacements` 적용 (Object/AuraArea/Item/Unit 사전배치, §6)
   - c. 몬스터 젠 / 웨이브 세팅 (Wave/Monster 시스템)

> **초기 유닛 소유권 (3b vs 3c 경계):** `initialPlacements`의 `layer:unit`은 **웨이브 이전에 보드에 미리 놓인 고정 유닛**(BuildBoard가 `TryOccupy`로 배치, 비-웨이브)이다. **웨이브 카운트에 포함되지 않는다.** 웨이브 기반 스폰은 전적으로 Wave 시스템(3c) 소유 — 시간이 지나며 스폰되는 몬스터는 `initialPlacements`가 아니라 Wave 데이터로 정의해야 이중 스폰/카운트 누락을 피한다. (둘 다 동일 `ResolvePlacement`+`TryOccupy(...,"unit",...)` 경로 사용, 소유 주체만 다름.)

- **단일 `BoardMap`** → 보드 추가 = 데이터 1행 (맵 에셋 추가 불필요).
- `void` = 그냥 스폰 안 함. 비정형·NxM·레이아웃별 cellSize 전부 런타임 계산.
- **하이어라키 규약(2026-07-09 확정 — 가독성 + 보드 전체 이동 지점):**
  ```
  BoardMap_runN (동적맵 루트)
  └── Board                  ← BoardRoot.model 앵커. 위치 = originOffset(BoardRenderProbe.BoardOrigin). board.rootRef
      └── Slot_c_r × 비-void 칸수   ← BoardSlot 앵커, 루트-로컬 CellToLocal 좌표. board.slots[key]
          ├── Tile_c_r              ← Ground 비주얼 (local 원점)
          ├── object/aura/item_c_r  ← 레이어 비주얼 (local z-0.05)
          └── unit_instN            ← 유닛 프리팹 루트 (local z-0.05, MonsterService 소유, 2026-07-10 개편)
              ├── Body              ← 클립 스프라이트(연출 대상)
              └── Gauge             ← HP/마나 게이지 (local y+0.45)
  ```
  맵 루트에 슬롯이 평면으로 깔리지 않고 `Board` 노드 하나로 묶인다. 보드 파괴(Result)도 루트 1개 Destroy로 연쇄 예정.
- 스폰된 셀은 `Board` 루트 경유 복제맵의 자식 → `board.rootRef`/`mapEntityRef`로 접근, `SetBoardVisible`/`GetChildByName` 계약 유지.
- **비주얼 뎁스 체계(2026-07-11 전면 확정 — OrderInLayer 단독 관리 폐기):** 뎁스는 3단 원칙으로 관리한다 — **SortingLayer = 밴드 간 구분(전역) · OrderInLayer = 밴드 안 종류별 서열 · Z = 같은 서열 안 행 기반 유사 깊이**(`CellToLocal`의 `z = row * 0.01`, 작은 row = 화면 아래 = 작은 z = 앞 — 코드 검증 2026-07-11). **밴드 계약은 "레이어 이름 + 상대 순서"다 — `LayerSortOrder` 절대값은 Maker 소유**(패널 조작·저장 시 연속 정수 0..N으로 강제 재부여됨을 실측, 2026-07-11: 10/20/30/40 → 1/2/3/4). 렌더러는 레이어를 이름으로 참조하므로 재번호에 영향 없음. OrderInLayer 서열(10 단위)은 우리 소유라 그대로 유지:

  | 상대 순서(뒤→앞) | 레이어 | 소속 비주얼 | 밴드 내 OrderInLayer 서열 |
  |:--:|---|---|---|
  | 0 | `Layer1` (엔진 기본) | 맵 배경/장식 | — (엔진 소유, 커스텀 배정 금지) |
  | 1 | `BoardGround` | Ground 타일(BoardCell/BlockCell) | 기본 0, 특수 타일 강조 1~9 |
  | 2 | `BoardProp` | 칸 위 정적물 | **오라(RageAura) 0 < 오브젝트(Rock) 10 < 아이템(AtkPotionItem.Icon) 20** — 같은 칸 공존(오라+아이템 등) 시 서열 보장 |
  | 3 | `BoardUnit` | 유닛 프리팹 Body(몬스터 클립) + 착석 플레이어(편입 예정 ⚠️) | Body 0 통일. 행 정렬은 slot z가 담당 |
  | (BoardUnit↑ 삽입 예약) | `BoardFx` *(미박제)* | 피격/스킬 이펙트, 데미지 텍스트, 드랍 팝 | 연출 확장 시 아래 정본 절차로 삽입 |
  | 4 | `BoardOverlay` | 월드 부착 오버레이 | 게이지 10 < 상태이상 아이콘 20(예약) < 타겟/선택 마커 30(예약) |

  **레이어 박제 정본 구조(2026-07-11 재구성 — Map Layer 패널 붉은 표시 이슈로 확정):** 커스텀 레이어는 Maker 패널 [+]가 만드는 구조 그대로 박제해야 패널에 정식(검정) 등록된다 — ① `MapleMapLayer_N` 엔티티(`nameEditable:false`, `origin.root_entity_id:null`, `MapLayerComponent.MapLayerName`=밴드 이름) + ② **짝 `RectTileMap_N` 엔티티**(`SortingLayer:"MapLayer{N}"`, 빈 tileMap) 쌍. 과거처럼 MapLayer 엔티티만 단독 주입하면 렌더링은 되지만 패널에 붉은(미등록) 표시가 뜬다. 새 밴드 추가는 패널 [+] 또는 이 정본 복제 절차만 사용.

  운영 규칙:
  - 각 `.model`의 렌더러 `SortingLayer`+`OrderInLayer` 값으로 **정적 배정** — 신규 비주얼 모델은 반드시 밴드 하나 + 밴드 내 서열을 명시(무명시 = Default 혼용 금지). 런타임 SortingLayer 변경 금지, 예외는 연출 코드에서 명시적으로만.
  - `MapLayer{N}`(짝 타일맵 SortingLayer 키)·`Layer1`은 엔진 소유 — 렌더러가 직접 참조하지 않는다(밴드 이름만 사용).
  - 화면 HUD/팝업(.ui)은 UI 캔버스 소관 — 이 체계 밖. **"월드에 부착되는 오버레이"(게이지 등)만 `BoardOverlay` 소속**이라는 경계를 유지한다.
  - ⚠️ 플레이어 편입 검증 대기: 착석(Init) 구현 시 아바타 렌더러를 `BoardUnit` 밴드로 배정 가능한지 인엔진 실측 필요. 불가하면 Default 잔류 + 보드 밴드와의 상대 순서를 실측으로 박제.

  근거 실측: OrderInLayer 단독으론 animationclip 재생 스프라이트에 밀림(2026-07-10), 레이어 혼용(Default vs MapLayer)은 우선순위가 암묵적(2026-07-09), 파일 단독 주입 레이어는 패널 미등록(붉은 표시)·SortOrder 절대값은 저장 시 재번호(2026-07-11).

> ✅ **인엔진 검증 게이트 — 해소(2026-06-30)**: `BoardRenderProbe.mlua` PoC로 검증 완료. `CreateDynamicMap('BoardMap')` → 텔레포트 → 동적맵 안에서 `SpawnByModelId`로 셀 25/25 + 몬스터자리 3/3 런타임 스폰 → **클라 play 카메라에 격자 정상 렌더 확인**(스크린샷). 박제 복제와 다른 "런타임 스폰" 경로가 정상 렌더됨이 입증됨 → 폴백(레이아웃별 박제맵, B안) 불필요. 본 구현 진행 가능.

---

## 2. 3계층 아키텍처

| 계층 | 역할 | 모델 |
|---|---|---|
| **① Board 데이터셋** | 레이아웃·셀타입·오브젝트/오라/아이템 타입·존·초기배치 정의 | CSV + JSON셀, `serveronly` |
| **② BoardCatalog (로더)** | 데이터셋 → 불변 `BoardDef`로 파싱·검증·캐시 | `StageCatalogLogic`처럼 deep-copy 게터 |
| **③ BoardService (런 점유)** | 무상태 레이어드 점유 + 배치해석 + 생명주기 | `run.board` (동적 상태만) |

---

## 3. 데이터셋 스키마 (`RootDesk/MyDesk/Zengard/Data/`)

> 스칼라 = CSV 컬럼, 중첩 = JSON 텍스트 셀. 전부 `serveronly=true`.

### 3.0 효과/모디파이어 공통 원자 (3계층 공유 계약) — 확정

> **결정(2026-06-29):** 스킬·보드·내실(메타성장)이 **단일 스탯 집계 엔진**을 공유한다. RPG 표준 패턴(Unity Kryzarel ≈ Unreal GAS Attribute+GameplayEffect). 보드는 효과를 **정의·적용·해제하지 않고**, 이 공통 `Modifier`를 *생성하는 source*일 뿐이다(해석·집계는 효과 시스템이 담당, §8).

**스탯 집계:** `Stat = baseValue + 거기 붙은 Modifier[]`. 최종값은 매 조회 시 재계산:
```
finalValue = baseValue
finalValue += Σ(Flat)                 # 평탄 가산
finalValue *= (1 + Σ(PercentAdd))     # 가산형 % (여러 +10% → 합산)
finalValue *= Π(1 + PercentMult)      # 곱연산 % (강버프, 개별 곱)
```

**Modifier (모든 효과의 공통 원자):**
```jsonc
{ "stat": "atk", "value": 0.3, "type": "percentAdd", "source": "aura:rage", "duration": "turns:2" }
// type:     "flat" | "percentAdd" | "percentMult"
// duration: "instant"        — 데미지 즉발(집계 후 즉시 소멸)
//           "turns:N"        — 임시버프·아이템 (N턴 후 효과 시스템이 자동 해제)
//           "infinite"       — 내실·런 상시
//           (생략 = nil)     — "소스 관리(while-source-active)": 외부(보드 점유/소스 생존) 가
//                              해제 시점을 통제. 오라칸 위에 있는 동안·셀 modifier가 여기 해당.
//                              효과 시스템은 이 Modifier를 스스로 만료시키지 않고 source 단위 해제 요청을 기다린다.
```
> ⚠️ duration 4상태는 **§3.0이 SSOT**. 사용처(§3.4 오라 생략, §3.5 turns→"turns:N")는 이 정의만 따른다.

**축약형 정규화 규칙(적재 시점):** JSON 효과 필드가 `Modifier[]`가 아닌 `{stat: number}` 객체면 다음으로 전개한다 —
각 `(stat → n)` 쌍을 `{ stat, type:"percentMult", value: n - 1 }` 로 변환(예: `1.3 → +0.3`, `0.7 → −0.3`), 다중 스탯 객체는 각 쌍을 개별 Modifier로 펼친다. **축약형은 percentMult 전용**(flat/percentAdd가 필요하면 명시형 배열을 써야 함 — 의도된 제약).

**3계층은 같은 Modifier가 `source`/`duration`만 다른 것:**
| 계층 | source 예 | duration |
|---|---|---|
| 캐릭터 데미지 | `level`/`char` | (baseValue·상시) — 집계 결과를 combat 데미지 공식에 투입 |
| **보드** | `aura:<auraId>` / `item:<itemId>` / `cell:<typeId>` | `turns:N`(아이템) 또는 생략=소스 관리(오라/셀) |
| 내실(메타) | `meta:<upgradeId>` | `infinite` (런 시작 시 주입) |

> AuraTypes·ItemTypes·CellTypes의 효과 필드(아래 §3.2/3.4/3.5)는 전부 **이 Modifier[] 형식**을 값으로 가진다. 효과 정의 포맷 단일화 → 후일 스킬·내실 통합 시 마이그레이션 불필요. 단 *타입 카탈로그*(AuraTypes/ItemTypes ↔ SkillTypes)는 트리거 의미가 달라 분리 유지.

### 3.1 `BoardLayouts`
| 컬럼 | 예시 | 형식 | 설명 |
|---|---|---|---|
| `layoutId` | `classic_7x7` | 스칼라 | 보드 식별자 |
| `cols` / `rows` | `7` / `7` | 스칼라 | NxM 격자 크기 |
| `cellSize` | `0.8` | 스칼라 | 셀 월드 크기(레이아웃별) |
| `cellOverrides` | `[{"pos":[3,3],"type":"block"},{"pos":[0,6],"type":"void"},{"type":"block","place":"random","count":2}]` | JSON | 기본=평지, 예외 셀타입만. **비정형 격자**는 `"void"`(=셀 없음)으로 표현. `pos` 없는 `{"place":"random","count":N}` 항목은 **런마다** `BoardService:ResolveRandomCellOverrides`가 def 복사본에 확정(카탈로그 캐시에 박제 금지) — 후보는 평지 중 `zones` 전체·고정(`pos`) `initialPlacements` 예약칸 제외. `void`는 고정 `pos` 전용(랜덤 불가) |
| `zones` | `{"spawnTop":[[0,0],[1,0]],"boss":[[3,3]]}` | JSON | 이름붙은 칸 집합(배치 해석용) |
| `initialPlacements` | `[{"layer":"object","objectId":"rock","place":"fixed","pos":[2,2]}, {"layer":"aura","auraId":"rage","place":"zone","zone":"boss"}, {"layer":"item","itemId":"atkPotion","place":"random","count":2}, {"layer":"unit","occupantId":"orangemushroom","occupantKind":"monster","place":"zone","zone":"spawnTop"}]` | JSON | **웨이브 이전 초기상태**. 레이어별 id 필드 통일: `objectId`/`auraId`/`itemId`/`occupantId`(+`occupantKind`). `place`/`pos`/`zone`/`count`는 §6 `ResolvePlacement`가 소비, **id 필드만 추출해 `TryOccupy`의 payload로 전달** |

### 3.2 `CellTypes` (Ground 카탈로그)
| 컬럼 | 예시 | 설명 |
|---|---|---|
| `typeId` | `plain` / `block` / `buffTile` | 기획자 정의 셀타입. **`void`는 예약 키워드**(데이터 행 아님): `cellOverrides`에서만 쓰이고 "셀 없음"을 의미 → 스폰 안 함, `IsInside`는 void 칸에 `false` 반환(§7). CellTypes에 `void` 행을 작성하지 않는다 |
| `occupiable` | `true` | 유닛이 설 수 있나 |
| `blocksMove` | `false` | 이동 차단 지형(벽 등) |
| `modifiers` | `[{"stat":"dmgTaken","type":"percentMult","value":0.2}]` (JSON) | 그 칸 위 유닛에 적용되는 기본 Modifier[] (§3.0). 축약 `{"dmgTaken":1.2}` 허용. source=`cell:<typeId>`, duration 생략(소스 관리)=칸 위에 있는 동안 |
| `model` | `BoardCell` | 비주얼 |

### 3.3 `ObjectTypes` (다용도 오브젝트)
| 컬럼 | 예시 | 설명 |
|---|---|---|
| `objectId` | `rock` / `totem` / `switch` | |
| `blocksMove` | `true` | 유닛 진입 차단 |
| `blocksSkill` | `true` | **스킬 범위/투사체 차단** (combat이 조회) |
| `blocksPlacement` | `true` | **칸 독점(2026-07-11 신설)** — 이 오브젝트가 있는 칸에는 유닛/아이템/오라를 배치할 수 없고, 역방향으로 aura/item/unit이 이미 점유한 칸에는 이 오브젝트를 배치할 수 없다(배치 순서 무관 불변식, §5 술어). 여러 블럭형 오브젝트가 재사용하는 데이터 플래그 |
| `gimmickId` | `null` / `pressurePlate` (JSON/스칼라) | 기믹 동작 참조(옵션) — 동작 정의는 §9 deferred |
| `model` | `Rock` | |

> **파괴가능 오브젝트(`hp`/`destructible`)는 §9로 deferred.** 데미지를 누가 어떻게 오브젝트에 입히는지가 combat 사양 의존이고, 런타임 hp 추적 필드(`run.board.cells.object.hp`)도 그때 함께 확정. 현 사양의 Object는 정적 장애물/차폐/기믹 트리거 용도로 한정.

### 3.4 `AuraTypes`
| 컬럼 | 설명 |
|---|---|
| `auraId` | |
| `effect` (JSON) | 부여할 **Modifier[]** (§3.0). 예: `[{"stat":"atk","type":"percentMult","value":0.3}]` 또는 축약 `{"atk":1.3}`. source=`aura:<auraId>`. 진입 시 적용, 이탈 시 해제(duration 생략=칸 점유 동안). 효과 해석·집계는 효과 시스템 위임(§8) |
| `model`/`vfx` | 바닥 표식 |

### 3.5 `ItemTypes`
| 컬럼 | 설명 |
|---|---|
| `itemId` | |
| `buffEffect` (JSON) | 픽업 시 부여할 **Modifier[]** (§3.0). 예: `[{"stat":"atk","type":"percentAdd","value":0.5}]`. source=`item:<itemId>` |
| `turns` | 지속 턴 수 → 부여되는 Modifier의 `duration="turns:N"` |
| `model` | 픽업 비주얼 |

### 3.6 `StageDefs` (전체 스테이지 관리)
| 컬럼 | 예시 | 설명 |
|---|---|---|
| `stageId` | `stage01` | 스테이지 식별자. `BoardRenderProbe.StageId`가 이걸 참조해 런을 시작 |
| `layoutId` | `classic_7x7` | 이 스테이지가 쓰는 보드 레이아웃(§3.1 참조). 스테이지 교체로 보드 구조 교체 가능 |
| `wavePlacements` | `[{"wave":1,"layer":"unit","occupantId":"orangemushroom","occupantKind":"monster","place":"zone","zone":"spawnTop","count":3},{"wave":2,"layer":"item","itemId":"atkPotion","place":"random","count":1}]` | JSON. **"몇 젠(웨이브)에서 무엇이 몇 개 등장"** 스케줄. 각 항목 = `wave`(정수 ≥1, 일치하는 WaveGen에서만 적용) + `initialPlacements`와 동일한 레이어별 id 필드/`place` 문법(§6). `BoardCatalogLogic:GetStageDef`가 적재·검증(layoutId 존재·wave 번호·zone 참조), `BoardService:ApplyWavePlacements(run, def, stageDef, wave)`가 WaveGen 페이즈(BoardFlowLogic)에서 소비 |

> `run.stageDef`/`run.def`는 `BoardRenderProbe.BuildBoard`가 런 시작 시 deep-copy로 실어 두고, 이후 페이즈는 데이터셋 재조회 없이 run 핸들만 소비한다.

---

## 4. 런타임 구조

### 4.1 `BoardDef` (불변, BoardCatalog 생성·캐시)
```lua
BoardDef = {
  layoutId, cols, rows, cellSize,
  cells     = { ["3_3"] = { typeId = "block" } },        -- 기본 평지, 예외만 명시
  cellTypes = { plain = {...}, block = {...} },          -- void는 cellTypes에 없음(예약 키워드, §3.2)
  zones     = { spawnTop = {{0,0},{1,0}}, boss = {{3,3}} },
  initialPlacements = { ... },                            -- §3.1
}
```
- `GetBoardDef(layoutId)` = **deep-copy 게터** (소비측 출처 무지, 현행 StageCatalog 계약과 동일).

### 4.2 `run.board` (휘발, 동적 점유만)
```lua
run.board = {
  defId        = "classic_7x7",     -- 정적 정의 참조(복사 아님)
  mapEntityRef, originOffset,       -- originOffset = Board 루트 위치(§1.5 하이어라키)
  rootRef, slots,                   -- Board 루트 앵커 / 칸별 slot 엔티티 핸들(비주얼 생명주기)
  cells = {
    ["3_4"] = {                     -- 레이어별 점유. nil = 비어있음
      aura   = { auraId,     instanceId } | nil,            -- 칸당 1개 (중첩 없음)
      object = { objectId,   instanceId } | nil,            -- 칸당 1개
      item   = { itemId,     instanceId } | nil,            -- 칸당 1개
      unit   = { occupantId, instanceId, occupantKind } | nil, -- 칸당 1개, 배타
    },
  },
}
```
- **Ground는 여기 없음** — 정적이라 `BoardDef`에만 존재.

**용어 사전 (전 레이어 공통):**
| 용어 | 정의 |
|---|---|
| `<layer>Id` | 정적 타입 참조(auraId/objectId/itemId). unit은 엔티티 참조 `occupantId` |
| `instanceId` | **레이어 점유 인스턴스의 고유 핸들**(전 레이어 통일). 같은 타입을 여러 칸에 둘 때 개별 식별·해제용. `TryOccupy`가 발급 |
| `source` (Modifier, §3.0) | 효과 추적 문자열. 보드 레이어에서 **파생**: `"aura:"..auraId` / `"item:"..itemId` / `"cell:"..typeId`. run.board에 별도 저장 안 함(중복 제거) |
| `occupantKind` / `kind` | unit 분류값. 허용 집합: **`monster` | `player` | `boss`**. `GetOccupantCount(...,kind)`·`initialPlacements`가 사용 |

---

## 5. 레이어 모델

스택 순서(아래→위, z-순서 = 점유 계층): **Ground → AuraArea → Object → Item → Unit**

| 레이어 | 정적/동적 | 칸당 | 의미 | 유닛 이동차단 | 유닛 진입 시 |
|---|---|---|---|---|---|
| **Ground** | 정적(BoardDef) | 1 | 바닥/지형. `occupiable`·`blocksMove`·기본 모디파이어 | `blocksMove`면 차단 | (항상 깔림) |
| **AuraArea** | 동적(+정적 시드) | **1 (중첩 없음)** | 서 있으면 버프/디버프 | 차단 안 함 | 효과 적용(떠나면 해제) |
| **Object** | 동적(+정적 시드) | 1 | **다용도**: 이동차단 장애물 / 스킬범위 차단 / 칸 독점(`blocksPlacement`) / 기믹 트리거. 데이터 플래그로 용도 결정 | `blocksMove`면 차단 | 기믹 트리거(옵션) |
| **Item** | 동적(+정적 시드) | 1 | N턴 버프 픽업(공격력업 물약 등) | 차단 안 함 | 픽업 → 버프 부여 후 제거 |
| **Unit** | 동적(+정적 시드) | **1 (배타)** | 몬스터/플레이어. 같은 칸에 둘 불가 | — | — |

> **명칭 주의:** "AuraArea"는 **칸당 1개**(반경/영역 개념 없음). 넓은 오라(예: 3×3)는 `initialPlacements`로 9칸을 각각 시드해야 한다. "Area"는 레이어 이름일 뿐 다중 칸을 뜻하지 않음.

**레이어별 배치 가능 술어** — §6 `ResolvePlacement`/§7 `GetEmptyCells`의 "배치가능"은 layer에 따라 아래 `CanPlace[Layer]`를 가리킨다. 각 술어는 해당 **layer가 비어있음**을 포함.

공통 술어 **`CanUnitStand`** = `IsInside(= void 칸 false) ∧ Ground.occupiable ∧ ¬Ground.blocksMove ∧ ¬(Object ∧ (Object.blocksMove ∨ Object.blocksPlacement))` — "유닛이 진입 가능한 칸". unit/item/aura 술어가 공유(2026-07-11 도입).

| layer | 술어 |
|---|---|
| **unit** (`CanPlaceUnit`) | `CanUnitStand ∧ unit 빈칸` |
| **object** (`CanPlaceObject`) | `IsInside ∧ ¬Ground.blocksMove ∧ object 빈칸` (벽 셀엔 오브젝트 안 둠). **`blocksPlacement` 오브젝트는 추가로 `aura/item/unit 전부 빈칸` 필요** — 칸 독점의 역방향(배치 순서 무관 불변식, 2026-07-11). 판정을 위해 `CanPlace`/`GetEmptyCells`에 payload(objectId)가 스레딩됨(§7) |
| **aura** (`CanPlaceAura`) | `CanUnitStand ∧ aura 빈칸` — **2026-07-11 개정: '지형 무관(벽 위에도 표식 가능)' 폐기.** 블럭 지형/바위 칸 위에 마법진이 그려지던 겹침 실측 → 오라는 유닛이 서야 발동하므로 유닛 진입 가능 칸 전용 |
| **item** (`CanPlaceItem`) | `CanUnitStand ∧ item 빈칸` — 아이템은 유닛이 밟아야 픽업되므로 유닛 진입 가능 칸(2026-07-10 수정: object 레이어 미검사로 바위 칸에 물약이 배치되던 버그) |

- **레이어 점유 충돌 일반 규칙**: 모든 `place` 모드는 위 술어로 후보를 거른다. `fixed`가 이미 점유된 칸/술어 불충족 칸을 가리키면 **스킵+경고**(§6). 두 시드가 같은 칸·같은 레이어를 노리면 둘째가 스킵된다(예: 오라 중첩 금지가 여기서 강제됨).

**모든 동적 레이어(Aura/Object/Item/Unit)는 `initialPlacements`로 정적 사전배치 가능** — 안 할 수도 있음(맵별 난이도 조절).

---

## 6. 배치 서술자 (`place`)

좌표 센티넬(`0`, `-1,-1`) **폐기** — `0`은 유효칸 (0,0)과 충돌, `-1,-1`은 "존 안 랜덤"을 표현 못 함. 대신 의도에 이름 붙인 서술자 사용.

### 문법
```jsonc
{ "place": "fixed",  "pos": [3, 4] }                 // 고정
{ "place": "random", "count": 3 }                    // 전체 빈칸 랜덤 N개 (count 생략=1, place 생략=random)
{ "place": "zone",   "zone": "spawnTop", "count": 2 }// 존 안 빈칸 랜덤 N개
{ "place": "center" }                                // 보드중심 최근접(보스) — 기존 특수로직 흡수
```

### 해석기 `ResolvePlacement(run, def, spec, layer) → cell[]`
**반환은 항상 `(col,row)` 배열**(0개=빈칸없음, 1개=단일, N개=count). 호출자는 배열을 순회. `count`(생략=1)는 random/zone에만 의미.
```
fixed  → [spec.pos] (검증 CanPlace[layer] 통과 시) | [] (불충족 시 스킵+경고)
random → 후보={ CanPlace[layer](모든 칸) }; 부분 Fisher-Yates로 min(count, #후보)개 (중복 없음)
zone   → 후보=def.zones[spec.zone] ∩ { CanPlace[layer] }; 위와 동일하게 count개
center → 후보 중 보드중심 최근접 1개, 동률 랜덤 (= GetEmptyCellNearestCenter); 항상 0~1개
빈칸 부족 시 요청보다 적게(또는 0개) 반환 + 로그. 호출자(wave 등)가 스킵/큐잉/대기 결정.
```
- **존 id 오타·존 좌표 검증은 BoardCatalog 적재 시점**(런타임 아님): `zones`의 모든 좌표가 `IsInside`(범위 내·non-void)인지, 알 수 없는 zone 참조가 `initialPlacements`에 없는지 검증·거부. 중복 좌표는 경고 후 dedup.
- **빈칸 없음(0개 반환) 시 wave 정책**: 보드 만석이면 스폰을 **큐잉**(다음 유닛 제거 시 재시도)하는 것이 기본 — 단 큐잉/드롭/대기의 최종 선택은 **Wave 시스템 사양 소유**(§8). 보드는 0개+로그만 보장.
- RNG는 현행 전역 `_UtilLogic`. 런별 결정론 PRNG는 deferred.

---

## 7. BoardService API (개정)

```
-- 순수 지오메트리 (ambient, def 인자화)
CellKey(col,row) · IsInside(def,col,row) · CellToWorld(def,board,col,row) · WorldToCell(def,board,pos)

-- 레이어드 점유 (ServerOnly)
TryOccupy(def, board, col, row, layer, payload) → instanceId | nil
   -- payload = 레이어별 테이블: {auraId=} / {objectId=} / {itemId=} / {occupantId=, occupantKind=}
   -- CanPlace[layer] 검증 통과 시 instanceId 발급·점유 기록 후 반환, 실패 시 nil
Release(board, col, row, layer, instanceId)    -- instanceId 불일치 무시(late-kill 보호) 계약 유지
GetCellLayer(board, col, row, layer)
ReplaceOccupant(def, board, col, row, layer, oldInstanceId, payload) → instanceId | nil
   -- oldInstanceId 불일치 시 nil(무시). 새 점유는 CanPlace[layer] 검증(그래서 def 필요), 불충족 시 nil

-- 질의 (ServerOnly)
CanPlace(def, board, col, row, layer, payload) -- §5 레이어별 술어 통합 진입점. payload는 object 레이어만
                                               -- 소비(objectId → blocksPlacement 판정), 그 외 nil 허용
BlocksSkill(def, board, col, row)              -- Object.blocksSkill (combat 조회)
GetEmptyCells(def, board, layer, zone, payload)-- CanPlace[layer] 만족 칸 목록(zone/payload nil 허용)
GetOccupantCount(board, layer, kind)           -- kind ∈ {monster|player|boss} (§4.2 용어사전)

-- 배치 해석
ResolvePlacement(run, def, spec, layer) → cell[]  -- §6 (항상 배열)

-- 점유 변화 훅 (ServerOnly) — §8 효과 발화점. 보드는 Modifier[] 생성·전달만, 적용은 효과 시스템.
OnUnitEnter(def, board, col, row) → Modifier[]
   -- 진입 칸의 cell modifier + aura.effect 를 수집, source 채우고 duration은 생략(=소스관리)으로 둔 Modifier[] 반환.
   -- item 점유 시 추가로: Item Release + buffEffect를 duration="turns:"..turns 로 변환해 포함(픽업).
OnUnitExit(def, board, col, row) → string[]
   -- 이탈로 해제할 source[] 반환(소스 관리 duration). turns:N 아이템 버프는 해제 대상 아님.
   -- ⚠️ TryOccupy/Release가 unit 레이어 변경 시 이 훅을 호출하는지(부수효과) vs 호출자가 명시 호출하는지는
   --    효과 시스템 사양과 함께 확정(§9). 본 문서는 보드가 노출할 훅의 시그니처·반환 계약만 박제.

-- 생명주기 (ServerOnly) — 런타임 스폰(§1.5) + initialPlacements 시딩
BuildBoard(run, def)   -- 비-void 칸 셀 스폰 + 배경 + 점유 초기화 + initialPlacements 적용
ResetBoard(run, def)
SetBoardVisible(run, visible)
DestroyBoard(run)
```

---

## 8. 크로스시스템 계약 (보드 범위 밖, 참조)

- **Combat / Skill**: 스킬 범위·투사체 판정 시 `BlocksSkill(def,board,c,r)` 조회. *정확한 차폐 규칙(칸 타격 차단 vs 경로 차단 vs 시야)은 combat 사양에서 확정* — 보드는 플래그만 노출.
- **효과/버프 시스템 (공유 Modifier 엔진, §3.0)**: 보드는 점유 이벤트(오라 진입/이탈, 아이템 픽업, 칸 modifier)에서 **공통 `Modifier[]`를 생성·전달**할 뿐, 스탯 집계·적용·해제는 효과 시스템이 담당. 이 엔진은 스킬·내실(메타성장)과 **동일**(보드 전용 아님). 보드는 `source`/`duration`만 채워 넘긴다. *유닛 진입 시 AuraArea 적용/이탈 시 해제, Item 픽업 시 turns→duration 변환.*
- **Wave / Monster / Boss**: 스폰 시 `ResolvePlacement`로 칸 결정 후 `TryOccupy(...,"unit",...)`. 기존 랜덤/보스중앙 특수함수는 `place` 모드로 흡수.

---

## 9. 미확정 / Deferred

- Object `blocksSkill`의 정밀 차폐 규칙(combat 사양 의존).
- 기믹(`gimmickId`) 동작 정의 — 별도 기믹 시스템 사양 필요.
- 런별 결정론 RNG(현재 전역 RNG로 충분, deferred).
- **효과 시스템 본체 사양**: §3.0은 보드가 의존하는 *공통 계약(Modifier 원자 + 집계 공식)* 만 확정. 실제 스탯 집계 엔진/`BuffComponent`/적용·해제 구현, 데미지 공식, 내실(메타성장) 주입 경로, 스킬 효과 정의는 **별도 효과 시스템 사양**에서 다룬다(보드와 분리 가능). MSW 엔진은 버프 네이티브 미지원 → `@Component BuffComponent` + 타이머 + 커스텀 이벤트로 직접 구현 필요.
- 스탯 키 집합(`atk`/`dmgTaken`/... 표준 목록)·`stacking` 정책(동일 source 중첩/캡/갱신) 확정 — 효과 시스템 사양과 함께.

> ✅ **해결됨 (A)**: 가변 NxM/void ↔ 맵 정합 → §1.5 단일 `BoardMap` 복제 + 런타임 스폰으로 확정(옛 D7 박제 폐기). 남은 건 인엔진 렌더 검증뿐(§1.5 게이트).
> ✅ **해결됨 (B, 2026-06-29)**: AuraArea/Item ↔ 효과 시스템 공유 여부 → §3.0 **공유 Modifier 엔진** 확정. 스킬·보드·내실 3계층이 단일 스탯 집계 엔진·효과 원자 공유, 타입 카탈로그만 분리. 효과 *포맷/집계 계약*은 보드 사양에 박제, 효과 *엔진 구현*은 위 Deferred로 분리.
