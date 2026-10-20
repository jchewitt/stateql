import {
  EDITOR_SOURCE,
  stateqlEditorSource,
  apolloEditorSource,
} from './forms/sources';
import { provideHttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideApollo } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { createBillingCache } from './data/cache';
import { App } from './app';
import { StateQLApp } from './stateql-app';
import { provideBillingClient } from './stateql-client';

const stateql =
  new URLSearchParams(window.location.search).get('client') === 'stateql';

void bootstrapApplication(stateql ? StateQLApp : App, {
  providers: stateql
    ? [
        provideBillingClient(new URL('/graphql', window.location.href).href),
        { provide: EDITOR_SOURCE, useFactory: stateqlEditorSource },
      ]
    : [
        provideHttpClient(),
        { provide: EDITOR_SOURCE, useFactory: apolloEditorSource },
        provideApollo(() => ({
          link: inject(HttpLink).create({ uri: '/graphql' }),
          cache: createBillingCache(),
        })),
      ],
}).catch((error: unknown) => console.error(error));
