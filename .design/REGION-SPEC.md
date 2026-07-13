# 지역/스테이지 진행 사양서 (Region → Stage Progression, 보드 리뉴얼)

> 상태: **초안 (draft, 2026-07-14) — 리뷰 전. 코드 착수는 이 사양 확정 후.** · 브랜치: `feature/board-renewal`
> 이 문서가 지역/스테이지 진행 구조의 단일 진실(SSOT). 보드 점유·배치는 [BOARD-SPEC.md](BOARD-SPEC.md), 몬스터는 [MONSTER-SPEC.md](MONSTER-SPEC.md)가 SSOT이며 이 문서는 그 계약을 소비만 한다(재정의 금지). 단, 이 사양이 요구하는 **기존 사양 개정 포인트**는 §9에 명시한다.

---

## 0. 배경 / 요구 (2026-07-14 사용자 확정)

기존 기획: 지역(메이플 아일랜드)에 스테이지 5개를 두고, **스테이지마다 새 맵에 입장**하는 느낌.
변경 기획: **지역 입장 = 1런**. 한 판 안에서 N젠 간격으로 스테이지가 넘어간다 —
`단풍나무 위 → 단풍나무 언덕 → 달팽이 동산 → 모험가의 수련장`.

- 기본 플레이 규칙(인게임 화면설계서 v1.0-CORE — 젠 1터치=1턴, 젠↔공격, 몬스터 누적)은 그대로.
- **전환 연출**: 레이어 구조 `배경 / 맵별 꾸미는 요소(MSW 리소스 데코) / 보드판+보드 요소 / UI`에서
  **데코 레이어만 옆으로 슬라이드**되어 다음 스테이지 분위기 + 다음 스테이지 몬스터 등장.
- **전환 조건**: 스테이지별로 "N젠 후(예: 단풍나무 위=10젠) 게이트 몬스터(기존 몬스터보다 강함, 크기 2×2) 등장 → 처치 시 다음 스테이지".
- **게이트 등급(2026-07-14 확정)**: 중간 스테이지 게이트 = **엘리트 보스**, 마지막 스테이지 게이트 = **보스**. 게이트 몬스터 등장 시 **일반 몬스터 젠 정지**(보스 스킬에 의한 소환은 예외 — EnemySkills 경로는 영향 없음).
- **몬스터 태그(2026-07-14 확정)**: 등급은 MonsterTypes의 `tags`가 소유 — `normal` / `eliteBoss` / `boss` + 후일 "추가 타(태그 기반 추가 피해)" 등 확장 개방. MONSTER-SPEC §2의 예약 컬럼 `tags` 활성화.
- **데이터 구조**: 전부 Stage 한 데이터셋에 넣으면 비대해지므로 **항목별 데이터셋으로 분리하고 Stage는 각 데이터셋의 id만 조합**한다.

원칙 (기존 사양 원칙의 적용):
1. **정적 정의 ↔ 휘발 진행 분리.** "지역이 어떤 스테이지들로 구성되나"는 데이터셋, "지금 몇 번째 스테이지·몇 젠째인가"는 `run.region`(런별 휘발).
2. **id 조합 데이터 모델.** StageDef는 콘텐츠를 들고 있지 않고 데코/스폰/게이트 데이터셋의 id만 참조한다(사용자 확정). 적재 시 참조 검증(§ occupantId 검증과 동일 패턴).
3. **보드 계약 존중.** 스폰·점유·배치 해석은 전부 BoardService/MonsterService 기존 API 경유. 이 사양은 "언제 무엇을 스폰/전환하나"의 스케줄만 소유.

---

## 1. 개념 계층

```
Region (지역)  = 런 단위. 판(layout)·스테이지 순서 소유.        예: 메이플 아일랜드
└─ Stage (스테이지) = 지역 내 구간. 데코·스폰 구성·게이트 소유.   예: 단풍나무 위
   └─ Gen (젠)      = 기존 젠/라운드 그대로(FSM 무변경 단위)
```

- **판(보드 레이아웃)은 지역 고정** — 화면설계서 ⑦ "한 판 진행 중 고정"과 일치. 스테이지 전환 시 보드판·유닛은 유지되고 데코만 교체된다(잔존 몬스터 누적 규칙 유지).
- 지역 클리어 = **마지막 스테이지의 게이트 보스 처치** → Result(승리). 기존 "웨이브 소진+전멸" 승리 판정은 폐기(§9).

---

## 2. 데이터셋 분해 (`RootDesk/MyDesk/Zengard/Data/`, 전부 `serveronly=true`)

> Stage가 id만 갖도록 4개 데이터셋으로 분리 + Region이 스테이지 순서를 소유. 스칼라 = CSV 컬럼, 중첩 = JSON 셀(기존 컨벤션).

### 2.1 `RegionDefs` (지역 — 신설)

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `regionId` | `maple_island` | 지역 식별자. `BoardRenderProbe.RegionId`(기존 StageId 대체)가 참조 |
| `name` | `메이플 아일랜드` | 표시명(HUD ② 스테이지 표기의 지역부) |
| `layoutId` | `classic_7x7` | 지역 고정 보드 레이아웃(BOARD-SPEC §3.1) |
| `stages` | `["maple_top","maple_hill","snail_hill","training_ground"]` | JSON. **스테이지 진행 순서**(StageDefs 참조). 적재 시 전 항목 존재 검증 |

### 2.2 `StageDefs` (스테이지 — 재편: id 조합 + 밸런스 스칼라만)

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `stageId` | `maple_top` | 스테이지 식별자 |
| `name` | `단풍나무 위` | 표시명(HUD ② + 전환 연출 자막) |
| `decorSetId` | `decor_maple_top` | → `StageDecors` (§2.3). 빈값 = 데코 없음 |
| `spawnSetId` | `spawn_maple_top` | → `SpawnSets` (§2.4) |
| `gateId` | `gate_maple_top` | → `GateDefs` (§2.5). **빈값 = 게이트 없음(마지막 스테이지 금지 — 적재 검증)** |
| `eliteCount` | `1` | 승격 엘리트 상한(MONSTER-SPEC §5.5 — 스테이지 구간 내 적용) |
| `blackOrbRate` | `0.2` | 일반 몬스터 검은 구슬 드랍률(MONSTER-SPEC §5.5) |

- 기존 `layoutId` 컬럼은 RegionDefs로 이동(판은 지역 소유). 기존 `wavePlacements`는 SpawnSets로 이동(§2.4).
- 마이그레이션: 기존 `stage01` 행은 신규 구조로 대체(§8 초기 데이터).

### 2.3 `StageDecors` (맵별 꾸미는 요소 — 신설)

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `decorSetId` | `decor_maple_top` | 식별자 |
| `elements` | `[{"ruid":"…","pos":[-4.5,2.0],"scale":1.2,"flipX":false,"order":0}]` | JSON. 데코 소품 목록 — MSW 리소스(sprite/animationclip RUID), 데코 루트 기준 로컬 좌표(월드 단위), `order`=밴드 내 서열. **RUID는 msw-search 실물만**(placeholder 금지 — MONSTER-SPEC과 동일 정책) |

- 소비: `StageDecorService`(§6)가 `DecorRoot` 아래 일괄 스폰, 전환 시 슬라이드 아웃/인.
- 렌더 밴드: 신설 `StageDecor` 밴드(§5 — Layer1과 BoardGround 사이).

### 2.4 `SpawnSets` (몬스터 스폰 구성 — 신설)

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `spawnSetId` | `spawn_maple_top` | 식별자 |
| `pool` | `[{"monsterId":"snail","weight":60},{"monsterId":"bluesnail","weight":40}]` | JSON. 젠 스폰 추첨 풀(정규화 가중치 — DropTables와 동일 추첨 방식). 적재 시 monsterId 존재 검증 |
| `perGen` | `4` | 젠당 신규 스폰 수(화면설계서 ⑧: 기본 4, **빈 칸 부족 시 남은 만큼** — ResolvePlacement 0~N 반환 계약 그대로) |
| `initialMin` / `initialMax` | `2` / `4` | 스테이지 진입 직후 1회 스폰 수 범위(화면설계서 ⑧: 진입 시 2~4 랜덤). 전환 직후에도 적용 — "다음 스테이지 몬스터 등장" |
| `spawnPlace` | `{"place":"random"}` | JSON. 스폰 배치 서술자(BOARD-SPEC §6 문법 그대로 — zone 지정 가능) |
| `extras` | `[{"gen":2,"layer":"item","itemId":"atkPotion","place":"random","count":1}]` | JSON(옵션). **스테이지-로컬 젠 번호** 매칭 특수 배치(아이템/오라 등) — 기존 wavePlacements 문법 재사용 |

> **스폰 모델 전환:** 기존 "wave 번호 매칭 배치(wavePlacements)" → "**매 젠 규칙 스폰(pool×perGen) + 진입 스폰 + extras**". 화면설계서 ⑧의 연속 누적 스폰 모델과 일치. 몬스터는 스폰 위치 고정·미처치 누적(기존 계약 그대로).

### 2.5 `GateDefs` (스테이지 전환 게이트 — 신설)

| 컬럼 | 예시 | 설명 |
|---|---|---|
| `gateId` | `gate_maple_top` | 식별자 |
| `afterGen` | `10` | 스테이지-로컬 N젠 도달 시 게이트 몬스터 스폰 |
| `monsterId` | `elite_stump` | 게이트 몬스터(MonsterTypes 참조). **`eliteBoss` 또는 `boss` 태그 필수** — 적재 시 존재+태그 검증. 강화 스탯·크기는 그 몬스터 행이 직접 소유(배율 컬럼 없음 — §2.6) |
| `place` | `{"place":"center"}` | JSON. 스폰 서술자(기본 center — 화면설계서 보스 관례) |

- 게이트 몬스터의 `occupantKind = "boss"`(등급 무관) — BOARD-SPEC kind 집합 {monster\|player\|boss} 그대로 수용. `TryPromoteElite` 승격 대상 아님(§5.5 boss 제외 규칙 유지), 검은 구슬은 boss도 드랍 가능(기존 규칙).
- **지역 마지막 스테이지의 게이트는 `boss` 태그, 중간 스테이지는 `eliteBoss` 태그** — RegionDefs 적재 시 순서 기반 교차 검증(불일치 = 경고).
- **용어**: MONSTER-SPEC §5.5의 "(승격) 엘리트"(오라 비주얼+확정 드랍, 일반 몬스터 대상)와 **엘리트 보스(eliteBoss 태그, 게이트)**는 별개 개념 — 이 문서에서 "게이트 몬스터" = 엘리트 보스/보스 통칭.

### 2.6 `MonsterTypes` 개정 (MONSTER-SPEC §2 소유 — 여기는 요구만)

| 컬럼 | 개정 | 설명 |
|---|---|---|
| `tags` | **예약 → 활성화** | 분류 태그 목록(JSON). 어휘(개방): `normal`(생략 시 기본) / `eliteBoss` / `boss` + 후일 속성·종족 등 "추가 타(태그 기반 추가 피해)" 태그 확장. 소비: GateDefs 태그 검증(§2.5)·HUD 보스 표기(§8)·후일 전투 보너스 |
| `size` | **신설** | JSON `[w,h]`, 생략 = `[1,1]`. 멀티셀 점유 크기(§7) — 2×2는 게이트가 아니라 **몬스터의 속성** |

- 엘리트 보스/보스는 **전용 MonsterTypes 행**으로 작성(예: `elite_stump` — 베이스 팩 클립 재사용 + 스탯 직접 기입). 런타임 배율 오버라이드 방식(구 초안) 폐기 — 데이터가 스탯의 단일 진실, "몬스터 추가 = 데이터 1행" 원칙 유지.

---

## 3. 런타임 구조: `run.region` (휘발)

```lua
run.region = {
  regionId,               -- RegionDefs 참조
  stageIndex,             -- 1-기반 현재 스테이지 순번
  stageId,                -- = regionDef.stages[stageIndex] (순회 편의)
  genInStage,             -- 스테이지-로컬 젠 수(WaveGen마다 +1, 전환 시 0 리셋)
  gateInstanceId,         -- 스폰된 게이트 보스 instanceId | nil (사망 판정용)
  gateCleared,            -- 이번 스테이지 게이트 처치 여부(전환 트리거)
  transitioning,          -- 전환 연출 중(입력 무시 가드)
}
```

- `BoardRenderProbe.BuildBoard`가 런 셋업 시 초기화(`stageIndex=1, genInStage=0`). `run.stageDef`/`run.spawnSet` 등 현재 스테이지의 def 캐시는 전환 시 갱신.
- 기존 `run.wave`는 **지역 누적 젠 수**로 유지(HUD 진행도·로그 연속성). 스테이지 판정은 `genInStage`만 사용.
- `run.maxWave`(소진형 승리 판정용)는 폐기(§9).

---

## 4. FSM 연동 (BoardFlowLogic — 페이즈 1개 신설)

| 페이즈 | 지역/스테이지 관련 동작 |
|---|---|
| `Init` | run.region 초기화 + **스테이지 1 데코 스폰**(슬라이드 없이 즉시) |
| `SkillSelect` | (무변경) 대기 — 메인 버튼 '젠' |
| `WaveGen` | `genInStage += 1` → **게이트 몬스터 생존 중이면 일반 스폰 전부 생략**(2026-07-14 확정 — 젠 카운트·재배치만 진행. 보스 스킬 소환은 EnemySkills 경로라 영향 없음) → ① 진입 첫 젠이면 initial 스폰(initialMin~Max) ② 그 외 pool×perGen 스폰 ③ extras(gen 매칭) ④ `genInStage == gate.afterGen`이면 **게이트 몬스터 스폰**(§7) + 이번 젠의 일반 스폰 생략 |
| `PlayerReady`→`Attack`→`MonsterAct`→`PostAttack` | (무변경 — 게이트 보스도 일반 유닛으로 피해/사망/턴이벤트 처리) |
| `DecideNext` | ① `run.region.gateCleared` → **`StageTransition` 진입** ② 그 외 기존대로 SkillSelect 루프. 패배 판정(빈칸<스폰수·플레이어 사망)은 별개 게이트(§10) |
| `StageTransition` **(신설)** | 처리 페이즈: `transitioning=true` → 데코 슬라이드 연출(§6) → 다음 스테이지 있으면 `stageIndex+1`·`genInStage=0`·데코 인·SkillSelect 복귀 / 마지막이면 **Result(승리)** |
| `Result` | (무변경) 정리 파이프 그대로 |

- 게이트 사망 감지: `KillUnit`은 무상태 유지 — `DecideNext`가 `run.region.gateInstanceId`의 unit이 `!alive`/제거됐는지 질의(폴링)로 판정(`gateCleared` 마킹). MonsterService에 콜백 훅을 심지 않는다(소유 분리 유지).
- 전환 연출 대기: `StageTransition`은 타이머 완료 후 다음 페이즈로 전이(슬라이드 시간 동안 메인 버튼 입력은 `RequestGen/Attack`의 phase 가드가 자동 차단).

---

## 5. 렌더 레이어 (BOARD-SPEC §1.5 밴드 개정 — 삽입 1건)

사용자 확정 레이어 순서 `배경 / 맵별 데코 / 보드판+요소 / UI`를 기존 밴드 체계에 삽입:

| 상대 순서(뒤→앞) | 레이어 | 소속 |
|:--:|---|---|
| 0 | `Layer1` (엔진) | 지역 공통 배경(BoardMap 박제) |
| **0.5 (신설)** | **`StageDecor`** | **스테이지별 꾸미는 소품(StageDecors 데이터) — 슬라이드 연출 대상** |
| 1~4 | `BoardGround` ~ `BoardOverlay` | (무변경 — 보드판·유닛·게이지) |
| — | UI 캔버스 | (무변경 — 체계 밖) |

- 밴드 신설은 BOARD-SPEC §1.5 **정본 절차**(MapleMapLayer_N + 짝 RectTileMap_N 쌍, Maker 패널 등록) 필수.
- 하이어라키: `BoardMap_runN > Decor(루트, StageDecorService 소유) > 소품들` — `Board` 루트의 형제. 슬라이드 = `Decor` 루트 1개 이동(보드 전체 이동 = Board 루트 1개 이동과 동일한 설계 사상).

---

## 6. StageDecorService (신설 @Logic, ServerOnly + 클라 연출)

```
SpawnDecor(run, decorSetId)        -- DecorRoot 생성(없으면) + elements 스폰(StageDecor 밴드 배정)
SlideTransition(run, fromSetId, toSetId, onDone)
   -- 구 데코 루트를 화면 밖으로 슬라이드 아웃(_TweenLogic) + 파괴,
   -- 새 데코 루트를 반대편에서 슬라이드 인. 완료 콜백으로 FSM 재개(§4 StageTransition).
DestroyDecor(run)                  -- Result/이탈 정리(DestroyBoard와 나란히 — BoardRenderProbe 정리 파이프에 편입)
```

- 무상태 @Logic — 데코 핸들은 `run.board.decorRootRef`에만.
- 슬라이드는 서버 위치 이동(@Sync 트랜스폼) 기반. 클라 보간 품질이 부족하면 클라 연출 RPC로 승격(구현 시 실측 — MONSTER-SPEC §8.3 연출과 동일 접근).

---

## 7. 게이트 몬스터 — 멀티셀 점유 (BOARD-SPEC/MONSTER-SPEC 개정 포인트)

**현행 제약**: unit 점유 = 칸당 1(BOARD-SPEC §4.2), `SpawnMonster` = 단일 칸. 2×2는 구조 확장 필요 — MONSTER-SPEC §8.4(보스 멀티셀)의 실체화. 크기의 출처는 **`MonsterTypes.size`**(§2.6 — 게이트가 아닌 몬스터 속성).

설계(최소 침습):
1. **점유**: anchor 칸(좌하단) + span 칸 전부에 **같은 instanceId**의 `rec.unit` 기록. `TryOccupyArea(def, board, col, row, w, h, payload) → instanceId | nil` 신설(전 칸 `CanPlaceUnit` 충족 시에만 원자 점유, 하나라도 실패 시 nil). `Release`도 area 대칭(`ReleaseArea` 또는 instanceId 기준 전 칸 해제).
2. **레지스트리**: `run.units[id].cells = {{c,r},...}` + `size = {w,h}` 추가(1×1 유닛은 기존 필드 그대로 — cells nil 허용, 소비측은 nil=단일 칸 해석).
3. **비주얼**: anchor slot 자식 1개 스폰 + `Body` 스케일 확대(cellSize×span 기준). 게이지는 anchor 상단 유지.
4. **질의 호환**: `GetUnitAt`은 어느 칸을 찍어도 같은 instanceId → 기존 코드 무변경으로 동작.
5. **스탯**: 전용 MonsterTypes 행이 직접 소유(§2.6) — `SpawnMonster`는 `def.size`만 읽어 area 경로로 분기(1×1은 기존 경로 무변경). 런타임 배율 없음.
6. **place=center**와 2×2: `ResolvePlacement` center 후보 판정을 area 술어로 — 구현 시 `TryOccupyArea` 실패하면 인접 후보 재시도(간단 스캔)로 충분.

---

## 8. 초기 데이터 (1차 — 메이플 아일랜드 4스테이지)

몬스터 분배는 카톡 수신 표의 "대표 출몰 맵"을 참고한 초안(기획 조정 전제):

| 순서 | stageId | 이름 | 스폰 풀(초안) | 게이트(초안) |
|:--:|---|---|---|---|
| 1 | `maple_top` | 단풍나무 위 | snail 60 / bluesnail 40 | 10젠 · `elite_stump` (eliteBoss, 2×2) |
| 2 | `maple_hill` | 단풍나무 언덕 | bluesnail 40 / spore 40 / redsnail 20 | 10젠 · `elite_redsnail` (eliteBoss, 2×2) |
| 3 | `snail_hill` | 달팽이 동산 | redsnail 35 / slime 35 / stump 30 | 10젠 · `elite_slime` (eliteBoss, 2×2) |
| 4 | `training_ground` | 모험가의 수련장 | pig 35 / orangemushroom 35 / ribbonpig 30 | 12젠 · `mushmom` (**boss**, 2×2) — 처치 = **지역 클리어** |

- **게이트 몬스터 = MonsterTypes 전용 행 신설(§2.6)**: `elite_stump`/`elite_redsnail`/`elite_slime`는 베이스 팩 클립 재사용 + 강화 스탯 직접 기입(초안: 베이스 hp×5~7, atk×2~2.5) + `tags:["eliteBoss"]` + `size:[2,2]`. 마지막 보스 `mushmom`은 보스급 팩 `mob/6130101.img`(MONSTER-SPEC §2 언급 — attack1/skill1 클립 보유)에서 RUID 확보 + `tags:["boss"]`. 일반 9종은 `tags` 생략(=normal).
- `RegionDefs`: `maple_island` = 위 4개 순서, `layoutId=classic_7x7`.
- `StageDecors`: 스테이지당 소품 3~5개 초안 — **RUID는 구현 단계에서 msw-search로 실물 확보**(단풍나무/언덕 바위/달팽이 표지판/수련장 허수아비 등, placeholder 금지).
- perGen=4 · initial 2~4 전 스테이지 공통 시작(밸런스는 CSV 튜닝).
- HUD(미커밋 더미) 영향: 진행도 ③ "보스까지 n/30 젠" → "**게이트까지 n/{afterGen} 젠**" + ② "메이플 아일랜드 — 단풍나무 위 (1/4)". 게이트 스폰 후엔 **게이트 몬스터 이름 + HP 표기로 전환**(화면설계서 ③ 보스 전환과 동형 — 일반 젠도 멈추므로 진행도 젠 카운트 표기는 숨김).

---

## 9. 기존 사양/코드 개정 포인트 (이 사양 확정 시 함께 반영)

| 대상 | 개정 |
|---|---|
| BOARD-SPEC §1.5 | `StageDecor` 밴드 삽입(정본 절차) |
| BOARD-SPEC §4.2/§7 | 멀티셀 unit 점유(`TryOccupyArea`/`ReleaseArea`) — §7 설계 반영 |
| BOARD-SPEC §3.6 | StageDefs 재편(§2.2) — wavePlacements/layoutId 이동 명시 |
| MONSTER-SPEC §2 | `tags` 예약 → 활성화(normal/eliteBoss/boss, 개방 어휘) + `size` 컬럼 신설(§2.6) |
| MONSTER-SPEC §5/§8.4 | `SpawnMonster` 멀티셀 분기(def.size) + run.units cells/size 확장 |
| MONSTER-SPEC §6 / BoardFlowLogic | DecideNext 승리 판정 교체: "웨이브 소진+전멸" → "마지막 게이트 처치". `run.maxWave` 폐기. `StageTransition` 페이즈 신설 |
| BoardRenderProbe | `StageId` → `RegionId`, run 셋업에 run.region/스테이지 캐시, 정리 파이프에 DestroyDecor 편입 |
| BoardCatalogLogic | `GetRegionDef`/`GetStageDef(재편)`/`GetStageDecor`/`GetSpawnSet`/`GetGateDef` + 상호 참조 검증 |
| IngameHud(미커밋 더미) | 진행도/스테이지 표기 갱신(§8) — 커밋 정책은 사용자 확인 |

---

## 10. 미확정 게이트 (기획 확인 필요)

1. ~~게이트 등장 후 일반 스폰 지속 여부~~ → ✅ **해소(2026-07-14): 게이트 몬스터 생존 중 일반 젠 정지**(보스 스킬 소환 예외 — §4 WaveGen). 화면설계서의 "보스전 스폰 계속" 규칙은 이 구조에서 폐기.
2. **전환 연출 상세** — 슬라이드 방향/시간/자막("단풍나무 언덕 진입") 연출 수위. 초안: 데코만 좌로 아웃·우에서 인, 0.8s.
3. **패배 판정** — 빈칸 부족(E-1)·플레이어 사망은 이 사양 밖(전투/코어루프 사양 소유). 게이트 몬스터 장기 미처치(M턴) 가중 패턴은 후속.
4. **스테이지별 판 크기 가변**(화면설계서 ⑦ 5/7/9) — 판은 지역 고정으로 초안 확정(전환 시 보드 유지가 전제). 스테이지별 가변이 필요해지면 "지역 = 판 크기 고정" 제약을 재검토.
5. 승격 엘리트(§5.5)와 게이트 몬스터의 드랍/검은구슬 상호작용 세부 — 초안: 게이트 몬스터 = boss 규칙 그대로(테이블 드랍 + 구슬 롤).
6. **태그 어휘 확장**("추가 타" 등 태그 기반 추가 피해) — 전투/스킬 사양 소유. MonsterTypes.tags는 개방 목록으로만 유지(§2.6), 소비 코드는 등급 3종(normal/eliteBoss/boss)만 우선.
7. **게이트 몬스터의 턴이벤트 스킬** — 초안: 기존 turnEvents/EnemySkills 파이프 그대로(elite/boss 행에 basic_attack 또는 전용 skillId). 소환형 스킬(스폰 정지의 예외 경로)은 EnemySkills 계열 핸들러 확장으로 수용.
