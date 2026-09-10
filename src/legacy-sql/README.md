# Legacy SQL/SQLite Code

This folder contains **deprecated** SQL/SQLite code that has been preserved for historical reference only.

## ⚠️ Important

**DO NOT import any files from this folder into the main MongoDB runtime.**

The project has migrated to MongoDB. This code is retained for:
- Historical reference
- Understanding legacy implementation
- Potential future migration if needed

## What's in this folder

- **notificationRepo.ts** - Old SQLite-based notification repository
- **clientRepo.ts** - Old SQLite-based client repository  
- **ruleRepo.ts** - Old SQLite-based rule repository
- **redFlagDetectorService.ts** - Old SQLite-based red flag detector (replaced by `mongoRedFlagDetectorService.ts`)
- **test-db.ts** - Old SQLite database test
- **test-runner.ts** - Old SQLite test runner

## MongoDB Equivalents

For current MongoDB implementations, see:
- `src/repositories/mongo*.ts` - MongoDB repositories
- `src/services/mongo*.ts` - MongoDB services
- `src/test-mongo.ts` - MongoDB tests
