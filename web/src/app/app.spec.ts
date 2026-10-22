import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
  });

  it('cria o shell do app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('mostra os destinos principais de decisão', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Hoje');
    expect(text).toContain('Investimento');
    expect(text).toContain('Medição e funil');
  });

  it('alterna o estado da barra lateral entre expandido e retraído', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const comp = fixture.componentInstance;
    const initial = comp['sidebarCollapsed']();
    comp['toggleSidebarCollapse']();
    expect(comp['sidebarCollapsed']()).toBe(!initial);
    comp['toggleSidebarCollapse']();
    expect(comp['sidebarCollapsed']()).toBe(initial);
  });
});
