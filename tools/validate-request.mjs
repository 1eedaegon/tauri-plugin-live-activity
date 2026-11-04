import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../contracts/request.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ strict: true, allErrors: true, ownProperties: true });
const validateShape = ajv.compile(schema);

/** Development reference validator. Does not call Tauri or any OS API. */
export function validateRequest(request) {
  if (!validateShape(request)) {
    return {
      valid: false,
      issues: validateShape.errors.map(({ instancePath, message }) => ({
        path: instancePath,
        message,
      })),
    };
  }

  if (request.command === 'end') return { valid: true, issues: [] };
  const { timer } = request.input.snapshot;
  if (timer && timer.endsAt <= timer.startedAt) {
    return {
      valid: false,
      issues: [{ path: '/input/snapshot/timer/endsAt', message: 'must be later than startedAt' }],
    };
  }

  return { valid: true, issues: [] };
}
