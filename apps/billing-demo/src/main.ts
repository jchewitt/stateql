import { provideHttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideApollo } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { createBillingCache } from './data/cache';
import { App } from './app';

void bootstrapApplication(App, {
  providers: [
    provideHttpClient(),
    provideApollo(() => ({
      link: inject(HttpLink).create({ uri: '/graphql' }),
      cache: createBillingCache(),
    })),
  ],
}).catch((error: unknown) => console.error(error));
