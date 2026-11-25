# Netlify 배포 및 Git 워크플로우 지침

> 이 파일은 Claude가 이 저장소에서 작업할 때 **항상** 따르는 지침입니다.
> 이 문서는 불필요한 Netlify 프로덕션 배포 크레딧 소모를 방지하고, 안정적으로 매일 결과물을 배포하기 위한 표준 개발·배포 절차를 정의합니다.

## Claude가 지킬 핵심 규칙 (요약)

1. `main` 브랜치에 직접 커밋·푸시하지 않는다. 오타·스타일 수정도 예외 없음.
2. 작업은 항상 작업 브랜치(`feat/...`, `fix/...`, 또는 세션이 지정한 `claude/...`)에서 한다.
3. 푸시 전에 로컬에서 테스트·프로덕션 빌드를 돌려 에러가 없는지 확인한다.
4. 작업 브랜치를 푸시하고 `main` 대상 PR(Draft 권장)을 연다. 수정은 새 PR 없이 같은 브랜치에 추가 커밋한다.
5. 사소한 수정은 모아서 한 번에 커밋·푸시한다.
6. `main` 머지는 사용자가 공개를 확정하고 승인했을 때만, 1회 한다(Squash and merge). 사용자 승인 없이 머지하지 않는다.

## 1. 크레딧 정책 요약

* 프로덕션 배포 (`main` 브랜치 반영): 15 크레딧 / 회
* 배포 미리보기 (`Deploy Preview` / PR 및 작업 브랜치): 0 크레딧 / 회
* 로컬 개발 및 빌드 테스트 (`localhost`): 0 크레딧 / 회

핵심 원칙: 모든 수정·테스트·모바일 확인은 로컬 및 PR Deploy Preview(0 크레딧)에서 완료하며, `main` 브랜치 머지(15 크레딧)는 최종 확정 시 딱 1회만 수행합니다.

## 2. 표준 개발 및 배포 절차 (GitHub PR 기반)

### 1단계: 작업 브랜치 생성 및 로컬 개발 (`0 크레딧`)

`main` 브랜치에 직접 커밋하지 않고, 작업 단위(날짜 또는 기능)별로 새 브랜치를 생성해 시작합니다.

```
git checkout main
git pull origin main
git checkout -b feat/day-01
```

* 로컬 개발 서버에서 기능 구현 및 레이아웃을 확인합니다.
* 원격 푸시 전 로컬 프로덕션 빌드 테스트를 먼저 실행해 빌드 에러가 없는지 검증합니다.

### 2단계: 브랜치 푸시 및 Pull Request 생성 (`0 크레딧`)

로컬 구현이 완료되면 작업 브랜치를 원격 저장소에 올리고 GitHub에서 `main`을 대상으로 Pull Request(Draft PR 권장)를 생성합니다.

```
git add .
git commit -m "feat: implement day-01 project"
git push -u origin feat/day-01
```

* PR이 열리면 Netlify가 자동으로 Deploy Preview URL을 생성합니다.

### 3단계: Deploy Preview 확인 및 수정 반영 (`0 크레딧`)

생성된 Deploy Preview URL을 통해 실제 배포 환경과 동일한 조건에서 최종 점검을 진행합니다.

* 모바일 화면 및 반응형 레이아웃 확인
* 외부 링크 공유 및 동작 테스트
* 수정 사항 발생 시 새 PR을 열지 말고 기존 작업 브랜치(`feat/day-01`)에만 추가 커밋 및 푸시합니다.

```
git add .
git commit -m "fix: adjust mobile layout and typos"
git push
```

미리보기가 여러 번 갱신되어도 프로덕션 배포가 아니므로 크레딧은 차감되지 않습니다.

### 4단계: 최종 확정 및 `main` 머지 (`15 크레딧 / 1회`)

Deploy Preview에서 모든 검증이 끝나고 공개가 확정되었을 때만 PR을 머지합니다.

1. GitHub PR 페이지에서 Squash and merge (또는 Merge pull request)를 실행합니다.
2. `main` 브랜치가 업데이트되면서 1회의 프로덕션 배포(15 크레딧)가 실행됩니다.

### 5단계: 로컬 동기화 및 브랜치 정리

머지 완료 후 다음 작업을 위해 로컬 `main` 브랜치를 최신화하고 완료된 작업 브랜치를 삭제합니다.

```
git checkout main
git pull origin main
git branch -d feat/day-01
```

## 3. 금지 사항 및 운영 수칙

1. **`main` 브랜치 직접 푸시 금지**
   * 사소한 오타나 스타일 수정이라도 `main`에 직접 `push`하면 즉시 15 크레딧이 차감됩니다. 반드시 작업 브랜치 → PR → 머지 순서를 지킵니다.
2. **수정 사항 묶어서 푸시하기**
   * 불필요한 빌드 대기를 줄이기 위해 사소한 수정은 로컬에서 한 번에 모아서 커밋·푸시합니다.
   * 실수로 푸시하여 불필요한 빌드가 실행된 경우, Netlify 대시보드에서 해당 빌드를 즉시 Cancel 처리합니다. (Claude는 대시보드를 직접 조작하지 않으므로 사용자에게 바로 알립니다.)
3. **Netlify 대시보드 설정 유지**
   * Build & deploy → Branches and deploy contexts에서 Production branch는 `main`으로 지정하고, Deploy previews는 활성화 상태를 유지합니다.
4. **배포 후 사후 수정 원칙**
   * 이미 `main`에 머지된 이후 수정이 필요할 경우에도 `main`에 직접 수정하지 않고, 새 수정 브랜치(`fix/...`)를 열어 PR 미리보기 검증 후 한 번에 머지합니다.

## 4. 현재 상황: GitHub Pages만 사용 중 (2026-11-24부터)

넷리파이는 크레딧 문제로 당분간 사용하지 않고 GitHub Pages만 씁니다. 위 원칙(작업 브랜치 → PR → 사용자 승인 후 `main` 1회 머지)은 **그대로** 적용합니다. 달라지는 점은 아래와 같습니다.

* GitHub Pages에는 PR별 Deploy Preview가 없습니다. 따라서 3단계의 미리보기 확인은 **머지 전 로컬 빌드 + `npm run preview`** 로 대신합니다. 휴대폰 확인이 필요하면 같은 와이파이에서 `npm run preview -- --host` 로 띄운 주소를 휴대폰으로 엽니다.
* 공개 저장소의 GitHub Actions·Pages는 무료라 크레딧이 깎이지는 않지만, `main`에 반영될 때마다 실제 사용자가 쓰는 앱이 바로 바뀝니다. 그래서 검증 안 된 변경이 `main`에 들어가지 않도록 같은 절차를 지킵니다.
* 넷리파이를 다시 쓰게 되면 1~3절의 Deploy Preview 절차로 돌아갑니다.

### 이 저장소(senior-transit-helper)에서 머지 전 확인하는 명령

이 저장소는 지금 따로 배포되지 않고, 공개 앱은 gildongmu 저장소(GitHub Pages)에서 나갑니다. 그래도 같은 절차를 지키고, 머지 전에 아래를 통과시킵니다.

```
npm test
npm run build
npm run preview -- --host
```
