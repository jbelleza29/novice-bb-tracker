.PHONY: dev-api dev-web build test

# Run in two terminals, then open http://localhost:3000 (passcode: dev)
dev-api:
	mkdir -p data
	cd api && NBT_PASSCODE=$${NBT_PASSCODE:-dev} NBT_DB=../data/dev.db go run .

dev-web:
	cd web && npm run dev

# Single binary at bin/nbt with the frontend embedded
build:
	cd web && npm ci && npm run build
	find api/dist -mindepth 1 ! -name .gitkeep -delete
	cp -R web/out/. api/dist/
	cd api && go build -o ../bin/nbt .

test:
	cd web && npm test && npx tsc --noEmit && npm run lint
	cd api && go vet ./...
