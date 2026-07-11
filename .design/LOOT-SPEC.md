# 전리품/런 인벤토리 상세 사양서 (Run-Scoped Loot Inventory)

> 상태: **확정 (2026-07-11 — §9 게이트 유저 확인 완료: 빈 가방 시작·메소 상한 없음(별도 재화 카운터)·드랍 테이블 메소 범위(min~max) 방식·토스트/사운드 포함). 코드 착수 가능.** · 브랜치: `feature/monster-structure`
> 이 문서가 전리품·런 인벤토리의 단일 진실(SSOT). 드랍 추첨은 [MONSTER-SPEC.md](MONSTER-SPEC.md) §2.5(DropTables)가, 보드 점유는 [BOARD-SPEC.md](BOARD-SPEC.md)가 SSOT — 이 문서는 두 계약을 소비만 한다.
> 방향 확정(2026-07-11, 유저): **런(인게임) 전용 휘발 인벤토리** + **옛메(클래식 메이플) 디자인 UI** + **자석펫식 획득 연출**(드랍이 유저에게 빨려와 획득 → 인벤 적립).

---

## 0. 설계 목표 / 원칙

MONSTER-SPEC §8.7에 예약해 둔 `loot` kind를 활성화한다. 몬스터 사망 드랍 중 `boardItem`(보드 칸 버프 픽업)과 달리, `loot`(전리품)는 **칸을 점유하지 않고** 유저에게 날아와 즉시 적립되는 보상 원자다.

원칙 (BOARD/MONSTER-SPEC 원칙의 적용):

1. **정적 정의 ↔ 휘발 인스턴스 분리.** "이 전리품이 무엇인가"는 `LootTypes` 데이터셋(read-only), "이번 런에 뭘 몇 개 주웠나"는 `run.lootBag`(런별 휘발). DataStorage 미사용 — **런 종료와 함께 소멸**(영구 보상 전환은 Result 정산 §6에서, 보상 시스템 사양 확정 시).
2. **데이터셋 구동.** 전리품 추가 = LootTypes 1행(+아이콘 RUID). 기존 config-dataset 패턴(CSV+JSON셀, `serveronly`, deep-copy 게터) 재사용.
3. **무상태 서비스.** `LootService`는 `run` 핸들을 인자로 받는다 — Logic 전역 상태 금지.
4. **드랍 계약 존중.** 추첨은 MonsterService.KillUnit(DropTables 정규화 가중치)이 소유. LootService는 "당첨된 loot의 전달·적립·연출"만 담당(추첨 재구현 금지).
5. **공식 인벤토리 패키지 미채택(2026-07-11).** `inventory-package`는 PlayerDBManager 기반 DB 영구 저장이 기본 설계 — 런 휘발 요구와 불일치. UI 무게도 과함(장비창·직업 연동). 자체 경량 구현.

---

## 1. 3계층 아키텍처 (BOARD/MONSTER-SPEC §2 미러)

| 계층 | 역할 | 모델 |
|---|---|---|
| **① LootTypes 데이터셋** | 전리품 카탈로그(식별자·표시명·아이콘·희귀도·스택) | CSV, `serveronly` |
| **② 카탈로그 (로더)** | 데이터셋 → 불변 `LootDef` 파싱·검증·캐시 | `BoardCatalogLogic.GetLootType` (기존 게터와 나란히) |
| **③ LootService (런타임)** | 드랍 수신·자석 연출·`run.lootBag` 적립·질의 | 무상태 `@Logic`, 상태는 `run.lootBag`에만 |

UI(④)는 클라 전용: `ui/LootInventory.ui` + `script.LootInventoryController` — 서버가 @Sync/RPC로 내려주는 가방 상태를 옛메 스타일 그리드로 페인트.

---

## 2. 데이터셋 스키마: `LootTypes` (`RootDesk/MyDesk/Zengard/Data/`)

| 컬럼 | 예시 | 형식 | 설명 |
|---|---|---|---|
| `lootId` | `mushroomCap` | 스칼라 | 식별자. DropTables entries의 `kind:"loot"` `id`가 참조 |
| `name` | `버섯 갓` | 스칼라 | UI 표시명(툴팁/획득 토스트) |
| `iconRuid` | `(실물 RUID)` | 스칼라 | 인벤 슬롯·자석 연출·토스트 비주얼. **msw-search로 확보한 실물만**(placeholder 금지 — MONSTER-SPEC §2 정책 동일). **아이콘 RUID는 이 카탈로그가 소유** — 드랍 테이블은 `lootId`만 참조하고 비주얼은 이 참조로 해석(여러 테이블이 같은 전리품을 공유해도 RUID 중복 없음, 2026-07-11 확정) |
| `rarity` | `common` | 스칼라 | `common/rare/epic/unique`(5차 기획서 레어도 4단 재사용). 1차 소비 = 슬롯 테두리 색 |
| `currency` | `false` / `true` | 스칼라(bool) | **재화 여부(2026-07-11 확정).** `true`(메소) = 슬롯을 점유하지 않고 `run.lootBag.currency[lootId]`에 무상한 누적, 인벤 하단 재화 줄에 표시(옛메 방식). `false` = 일반 슬롯 아이템 |
| `maxStack` | `99` | 스칼라(number) | 슬롯당 최대 스택(일반 아이템만 — `currency=true`는 무시). 초과 시 새 슬롯 |
| `pickupSound` | `(실물 RUID)` | 스칼라 | 획득 사운드(effect 오디오). 종류별 분리 — 일반 아이템은 픽업음, 메소는 동전 짤랑(2026-07-11 확보: `f399837e…`/`25e9b277…`) |

- **획득 경로 계약(MONSTER-SPEC §2.5 그대로):** `loot` = 즉시 적립(칸 점유 없음). `boardItem`(보드 픽업)·`equip`(장비, §8.7 예약)과 대분류 분리 유지.
- **메소 드랍 방식(2026-07-11 확정 — RPG 표준):** 몬스터별 메소 획득량은 **그 몬스터의 드랍 테이블 엔트리에 `min`/`max` 범위로 지정**하고, 킬 시 범위 내 균등 랜덤으로 굴린다(`{kind:"loot","id":"meso","weight":…,"min":10,"max":30}`). DropTables 엔트리의 기존 `min`/`max` 필드를 그대로 소비 — `min`/`max` 생략 시 count=1.
- 적재 시 검증: DropTables의 `kind:"loot"` `id` → LootTypes 존재(§2.5의 boardItem 검증과 동일 패턴). **기존 "loot 카탈로그 미신설 log_warning" 제거.**

### 초기 데이터 (1차)

```csv
lootId,name,iconRuid,rarity,currency,maxStack,pickupSound
mushroomCap,주황버섯의 갓,b871877a7c394eafb176a9fed9b7c415,common,false,99,f399837e702843abb2c8196829101982
meso,메소,02a489cccff24a139a6c3582a5871f58,common,true,0,25e9b2779bd540fd9c8bb931d8363439
```

(아이콘/사운드 RUID는 2026-07-11 msw-search 실물 확보: 주황버섯 아이템 스프라이트 40×48, 금색 메소 동전 28×24, 아이템 획득음 0.52s, 동전 짤랑음 0.89s)

DropTables `mushroomTier` 개정: `[{boardItem atkPotion 30},{loot mushroomCap 40, min1 max2},{loot meso 20, min10 max30},{꽝 10}]` (수치는 밸런싱 대상).

---

## 3. 런타임 구조: `run.lootBag` (휘발)

```lua
run.lootBag = {
  slots = {                      -- 배열 = 획득 순서(옛메처럼 빈 앞슬롯부터 채움). 런 시작 = 빈 배열(초기 지급 없음)
    { lootId, count },           -- count <= LootTypes.maxStack
  },
  currency = { [lootId] = n },   -- 재화(메소 등, currency=true) — 슬롯 미점유·상한 없음
  totalGained = { [lootId] = n } -- 누계(Result 정산·통계용)
}
```

- **런 시작 = 빈 가방**(2026-07-11 확정 — 초기 전리품 지급 없음, UI도 빈 슬롯으로 시작).
- 적립 규칙: `currency=true`면 `currency[lootId] += count`(상한 없음). 일반 아이템은 같은 `lootId`의 미만석 슬롯에 합산 → 없으면 새 슬롯 push. 슬롯 상한(§5 UI 24칸) 도달 시 **적립은 유지하되 초과분은 totalGained에만 기록 + 경고 로그**(1차 — UI 미표시, 옛메 "가방이 가득 찼습니다"류 처리 확장 예약).
- `run.lootBag`은 `BoardRenderProbe.BuildBoard`의 run 셋업에서 초기화.

---

## 4. LootService API (무상태 `@Logic`)

```
-- 드랍 수신 (MonsterService.KillUnit의 loot 당첨 분기가 호출 — 기존 log-skip 대체)
GainLoot(run, col, row, lootId, count) → boolean
   -- LootTypes 검증 → run.lootBag 적립 → 클라 자석 연출 RPC + 가방 동기화.
   -- 죽은 칸 (col,row) = 연출 시작점.

-- 자석 연출 + 획득 피드백 (ClientOnly — 서버는 트리거만)
PlayMagnetFx(mapEntity, fromPos, lootId, count)
   -- 죽은 칸 월드좌표에 아이콘 스프라이트 로컬 스폰 → _TweenLogic으로 로컬 플레이어
   --   아바타 위치로 가속 이동(자석펫 감각: 짧은 팝업 후 흡입, 0.4~0.6s) → 도착 시 Destroy
   --   → 도착 시점에 획득 토스트 + 픽업 사운드(아래) 발화.
   -- 로컬 엔티티(클라 전용) 사용 — 서버 점유/보드 계약과 무관한 순수 연출.
   -- 획득 토스트(1차 포함, 2026-07-11 확정): "버섯 갓 1개를 얻었습니다." / "메소 30을 얻었습니다."
   --   옛메 감각의 하단/채팅 알림 텍스트. 픽업 사운드는 msw-search로 확보(옛메 픽업음 계열).

-- 질의 (UI·Result가 소비)
GetBag(run) → slots deep-copy
CountLoot(run, lootId) → integer
```

- **책임 경계:** 추첨(무엇이 몇 개)은 MonsterService.KillUnit 소유. LootService는 적립·연출·질의만. Result 정산(영구 보상 전환)은 보상 시스템 사양 확정 시 §6에 이음.
- 동기화: 가방은 서버 진실. 클라 UI에는 `@ExecSpace("Client")` RPC로 슬롯 스냅샷 push(가방 변경 시마다) — 런 휘발이라 @Sync 테이블보다 단순 RPC가 적합(멀티 대비 대상 유저 지정 가능).

---

## 5. UI: 옛메 디자인 인벤토리 (`ui/LootInventory.ui`)

- **레이아웃(클래식 메이플 아이템 창 오마주):** 타이틀바("아이템") + 닫기 버튼 / 슬롯 그리드 **4열 × 6행 = 24슬롯**(36×36px 슬롯, 옛메 비율) / 하단 메소 표시줄(lootId `meso` 누계 별도 표기). 창 크기 약 240×340px, 우측 하단 기본 배치, 드래그 이동은 확장 예약.
- **비주얼 소스:** msw-search로 옛메풍 창 프레임·슬롯 9-slice 리소스 탐색 — 없으면 msw-ui-system 스타일 템플릿 + 옛메 팔레트(갈색 프레임 `#8B6D4B`/베이지 바탕 `#EFE5D0`/감청 타이틀)로 재현. 아이콘은 LootTypes.iconRuid.
- **열기/닫기:** HUD 가방 버튼(우하단) + 단축키 `I`(key-binding은 1차 생략 가능 — HUD 버튼 우선). 팝업은 전용 UIGroup 분리(msw-ui-system 규약), 토글 = 자식 Enable.
- **갱신:** 서버 슬롯 스냅샷 RPC 수신 → 그리드 페인트(레어도 테두리 색, count 뱃지). 획득 순간 슬롯 하이라이트 점멸(연출 확장 예약).
- **경계:** 이 창은 `.ui` 캔버스 소관 — 보드 SortingLayer 체계(BOARD-SPEC §1.5) 밖.

---

## 6. FSM 연동 / Result

| 페이즈 | 동작 |
|---|---|
| (런 시작) | `run.lootBag` 초기화, 인벤 UI 빈 상태 push |
| `PostAttack` | (변경 없음 — 적립은 KillUnit 시점에 이미 완료) |
| `Result` | `totalGained` 요약을 결과 처리에 노출(1차 = 로그). **영구 보상 전환(계정 재화/장비 지급)은 보상 시스템 사양 확정 시** — 그 전까지 런 종료 = 소멸 |

---

## 7. 검증 계획

1. **SelfTest(카탈로그):** `GetLootType("mushroomCap")` 로드·deep-copy 격리, DropTables loot 참조 검증(미존재 id → 에러) 확인.
2. **SelfTest(서비스):** 더미 run으로 GainLoot 반복 — 스택 합산/새 슬롯/maxStack 경계/슬롯 상한 초과 경고 확인.
3. **인엔진:** play → 몬스터 처치(`maker_execute_script`로 ApplyDamage) → loot 당첨 시 자석 연출(아이콘이 아바타로 흡입) 확인 → 인벤 버튼 → 옛메 창에 슬롯 적립 확인 → `logs`.

---

## 8. 확장 예약 / Deferred

- 가방 가득참 UX(옛메 "더 이상 담을 수 없습니다"), 슬롯 드래그 정렬, 툴팁.
- `equip` kind(장비 — EquipTypes, 슬롯3·레어도4단·태그)는 인벤토리/장비 시스템 사양 확정 시(MONSTER-SPEC §8.7 유지).
- Result 정산 → 계정 영구 보상 파이프(보상 시스템 사양).
- 멀티: 유저별 lootBag 분리(`run.lootBag[userId]`) — 1차 싱글은 단일 가방, 구조는 확장 가능하게 함수 시그니처에 run만 관통.

---

## 9. 게이트 결정 이력 (2026-07-11 유저 확인 — 전부 해소)

1. 런 시작 = **빈 가방**(초기 지급 없음). 아이콘 RUID는 **LootTypes 카탈로그 소유**(드랍 테이블은 lootId 참조만).
2. **메소 = 별도 재화 카운터**(슬롯 미점유·상한 없음), 획득량은 **몬스터별 드랍 테이블의 min~max 범위 굴림**(RPG 표준 방식 채택).
3. **획득 토스트 + 픽업 사운드 1차 포함.**
4. 슬롯 수 24·일반 아이템 스택 99·창 크기는 제안값 유지(밸런싱/UX 조정 대상).
