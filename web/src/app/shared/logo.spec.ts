import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BRAND } from '../brand';
import { ThemePreference, ThemeService } from '../core/theme.service';
import { Logo, LogoTone, LogoVariant } from './logo';

class FakeThemeService {
  readonly preference = signal<ThemePreference>('light');
  readonly resolved = signal<'light' | 'dark'>('light');

  setTheme(t: 'light' | 'dark'): void {
    this.resolved.set(t);
  }
}

@Component({
  imports: [Logo],
  template: `
    <app-logo [variant]="variant()" [tone]="tone()" [customClass]="customClass()" />
  `,
})
class TestHost {
  readonly variant = signal<LogoVariant>('expanded');
  readonly tone = signal<LogoTone>('auto');
  readonly customClass = signal('');
}

describe('Logo', () => {
  let fakeTheme: FakeThemeService;
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;

  beforeEach(async () => {
    fakeTheme = new FakeThemeService();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: ThemeService, useValue: fakeTheme }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('exibe logo expandido Dark para fundo claro por padrão no tema claro', () => {
    fakeTheme.setTheme('light');
    host.variant.set('expanded');
    host.tone.set('auto');
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.expandedDark);
  });

  it('exibe logo expandido Light para fundo escuro no tema escuro', () => {
    fakeTheme.setTheme('dark');
    host.variant.set('expanded');
    host.tone.set('auto');
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.expandedLight);
  });

  it('exibe símbolo Dark para fundo claro quando retraído', () => {
    fakeTheme.setTheme('light');
    host.variant.set('symbol');
    host.tone.set('auto');
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.symbolDark);
  });

  it('exibe símbolo Light para fundo escuro quando retraído no tema escuro', () => {
    fakeTheme.setTheme('dark');
    host.variant.set('symbol');
    host.tone.set('auto');
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.symbolLight);
  });

  it('permite forçar tom dark ou light independente do tema', () => {
    fakeTheme.setTheme('dark');
    host.variant.set('symbol');
    host.tone.set('dark');
    fixture.detectChanges();

    let img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.symbolDark);

    fakeTheme.setTheme('light');
    host.tone.set('light');
    fixture.detectChanges();

    img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(BRAND.logos.symbolLight);
  });
});
