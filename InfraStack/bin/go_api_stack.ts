#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { GoApiStackStack } from '../lib/go_api_stack-stack';

const app = new cdk.App();
new GoApiStackStack(app, 'GoApiStackStack');
