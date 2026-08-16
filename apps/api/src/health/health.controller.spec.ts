import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok without touching any dependency', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
