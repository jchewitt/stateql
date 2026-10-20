import { JsonPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import type { FixtureService } from './fixture.service';

@Component({
  selector: 'request-inspector',
  imports: [JsonPipe],
  templateUrl: './request-inspector.html',
})
export class RequestInspector {
  readonly fixture = input.required<FixtureService>();
}
