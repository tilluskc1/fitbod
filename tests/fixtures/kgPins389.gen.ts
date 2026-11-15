// (#389/#391) Generates kgPins389-main.json.gz from the code at main 20d3e76: every kg result the lb-grid fix must
// leave alone. Run once before the fix: node tests/fixtures/kgPins389.gen.ts | gzip > tests/fixtures/kgPins389-main.json.gz
import { kgPinCases } from './kgPins389.cases.ts';
process.stdout.write(`${JSON.stringify(kgPinCases())}\n`);
