import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccessToken, accessTokenInterceptor } from './access-token';

describe('accessTokenInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([accessTokenInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    ctrl.verify();
    vi.restoreAllMocks();
  });

  it('não envia nada quando não há código guardado', () => {
    http.post('/api/search', {}).subscribe();
    const req = ctrl.expectOne('/api/search');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('envia o código guardado só para /api', () => {
    localStorage.setItem('openads.accessToken', 'abc');
    http.post('/api/search', {}).subscribe();
    expect(ctrl.expectOne('/api/search').request.headers.get('Authorization')).toBe('Bearer abc');
    http.get('/outra-coisa').subscribe();
    expect(ctrl.expectOne('/outra-coisa').request.headers.has('Authorization')).toBe(false);
  });

  it('em 401 pede o código, guarda e repete a chamada', async () => {
    vi.spyOn(globalThis, 'prompt').mockReturnValue(' novo-codigo ');
    const done = new Promise((resolve) => http.post('/api/search', {}).subscribe(resolve));
    ctrl.expectOne('/api/search').flush({ error: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(ctrl.match('/api/search').length).toBeGreaterThanOrEqual(0));
    const retry = await vi.waitFor(() => {
      const [r] = ctrl.match('/api/search');
      if (!r) throw new Error('aguardando repetição');
      return r;
    });
    expect(retry.request.headers.get('Authorization')).toBe('Bearer novo-codigo');
    retry.flush({ ok: true });
    await done;
    expect(TestBed.inject(AccessToken).get()).toBe('novo-codigo');
  });

  it('se a pessoa cancelar o pedido, o erro 401 chega ao chamador', async () => {
    vi.spyOn(globalThis, 'prompt').mockReturnValue(null);
    const err = new Promise<number>((resolve) => http.post('/api/search', {}).subscribe({ error: (e) => resolve(e.status) }));
    ctrl.expectOne('/api/search').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await err).toBe(401);
  });
});
