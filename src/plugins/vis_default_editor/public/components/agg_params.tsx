/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useCallback, useReducer, useEffect, useMemo } from 'react';
import { EuiForm, EuiAccordion, EuiSpacer } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import useUnmount from 'react-use/lib/useUnmount';

import { IAggConfig, IndexPattern, AggGroupNames } from '../../../data/public';

import { DefaultEditorAggSelect } from './agg_select';
import { DefaultEditorAggParam } from './agg_param';
import {
  getAggParamsToRender,
  getAggTypeOptions,
  isInvalidParamsTouched,
} from './agg_params_helper';
import {
  aggTypeReducer,
  aggParamsReducer,
  AGG_PARAMS_ACTION_KEYS,
  initAggParamsState,
} from './agg_params_state';
import { DefaultEditorCommonProps } from './agg_common_props';
import { EditorParamConfig, TimeIntervalParam, FixedParam, getEditorConfig } from './utils';
import { Schema, getSchemaByName } from '../schemas';
import { useOpenSearchDashboards } from '../../../opensearch_dashboards_react/public';
import { VisDefaultEditorOpenSearchDashboardsServices } from '../types';

const FIXED_VALUE_PROP = 'fixedValue';
const DEFAULT_PROP = 'default';
type EditorParamConfigType = EditorParamConfig & {
  [key: string]: unknown;
};

export interface DefaultEditorAggParamsProps extends DefaultEditorCommonProps {
  agg: IAggConfig;
  aggError?: string;
  aggIndex?: number;
  aggIsTooLow?: boolean;
  className?: string;
  disabledParams?: string[];
  indexPattern: IndexPattern;
  setValidity: (isValid: boolean) => void;
  setTouched: (isTouched: boolean) => void;
  schemas: Schema[];
  allowedAggs?: string[];
  hideCustomLabel?: boolean;
}

function DefaultEditorAggParams({
  agg,
  aggError,
  aggIndex = 0,
  aggIsTooLow = false,
  className,
  disabledParams,
  groupName,
  formIsTouched,
  indexPattern,
  metricAggs,
  state,
  setAggParamValue,
  onAggTypeChange,
  setTouched,
  setValidity,
  schemas,
  allowedAggs = [],
  hideCustomLabel = false,
}: DefaultEditorAggParamsProps) {
  const schema = useMemo(() => getSchemaByName(schemas, agg.schema), [agg.schema, schemas]);
  const aggFilter = useMemo(() => [...allowedAggs, ...(schema.aggFilter || [])], [
    allowedAggs,
    schema.aggFilter,
  ]);
  const { services } = useOpenSearchDashboards<VisDefaultEditorOpenSearchDashboardsServices>();
  const aggTypes = useMemo(() => services.data.search.aggs.types.getAll(), [
    services.data.search.aggs.types,
  ]);
  const groupedAggTypeOptions = useMemo(
    () => getAggTypeOptions(aggTypes, agg, indexPattern, groupName, aggFilter),
    [aggTypes, agg, indexPattern, groupName, aggFilter]
  );

  const error = aggIsTooLow
    ? i18n.translate('visDefaultEditor.aggParams.errors.aggWrongRunOrderErrorMessage', {
        defaultMessage: '"{schema}" aggs must run before all other buckets!',
        values: { schema: schema.title },
      })
    : '';
  const aggTypeName = agg.type?.name;
  const fieldName = agg.params?.field?.name;
  const editorConfig = useMemo(() => getEditorConfig(indexPattern, aggTypeName, fieldName), [
    indexPattern,
    aggTypeName,
    fieldName,
  ]);
  const params = useMemo(
    () => getAggParamsToRender({ agg, editorConfig, metricAggs, state, schemas, hideCustomLabel }),
    [agg, editorConfig, metricAggs, state, schemas, hideCustomLabel]
  );
  const allParams = [...params.basic, ...params.advanced];
  const [paramsState, onChangeParamsState] = useReducer(
    aggParamsReducer,
    allParams,
    initAggParamsState
  );
  const [aggType, onChangeAggType] = useReducer(aggTypeReducer, { touched: false, valid: true });

  const isFormValid =
    !error &&
    aggType.valid &&
    Object.entries(paramsState).every(([, paramState]) => paramState.valid);

  const isAllInvalidParamsTouched =
    !!error || isInvalidParamsTouched(agg.type, aggType, paramsState);

  const onAggSelect = useCallback(
    (value) => {
      if (agg.type !== value) {
        onAggTypeChange(agg.id, value);
        // reset touched and valid of params
        onChangeParamsState({ type: AGG_PARAMS_ACTION_KEYS.RESET });
      }
    },
    [onAggTypeChange, agg]
  );

  // reset validity before component destroyed
  useUnmount(() => setValidity(true));

  useEffect(() => {
    Object.entries(editorConfig).forEach(([param, paramConfig]) => {
      const paramOptions = agg.type.params.find((paramOption) => paramOption.name === param);

      const hasFixedValue = paramConfig.hasOwnProperty(FIXED_VALUE_PROP);
      const hasDefault = paramConfig.hasOwnProperty(DEFAULT_PROP);
      // If the parameter has a fixed value in the config, set this value.
      // Also for all supported configs we should freeze the editor for this param.
      if (hasFixedValue || hasDefault) {
        let newValue;
        let property = FIXED_VALUE_PROP;
        let typedParamConfig: EditorParamConfigType = paramConfig as FixedParam;

        if (hasDefault) {
          property = DEFAULT_PROP;
          typedParamConfig = paramConfig as TimeIntervalParam;
        }

        if (paramOptions && paramOptions.deserialize) {
          newValue = paramOptions.deserialize(typedParamConfig[property]);
        } else {
          newValue = typedParamConfig[property];
        }

        // this check is obligatory to avoid infinite render, because setAggParamValue creates a brand new agg object
        if (agg.params[param] !== newValue) {
          setAggParamValue(agg.id, param, newValue);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorConfig]);

  useEffect(() => {
    setTouched(false);
  }, [agg.type, setTouched]);

  useEffect(() => {
    setValidity(isFormValid);
  }, [isFormValid, agg.type, setValidity]);

  useEffect(() => {
    // when all invalid controls were touched or they are untouched
    setTouched(isAllInvalidParamsTouched);
  }, [isAllInvalidParamsTouched, setTouched]);

  return (
    <EuiForm
      className={className}
      isInvalid={!!error}
      error={error}
      data-test-subj="visAggEditorParams"
    >
      <DefaultEditorAggSelect
        aggError={aggError}
        id={agg.id}
        indexPattern={indexPattern}
        value={agg.type}
        aggTypeOptions={groupedAggTypeOptions}
        isSubAggregation={aggIndex >= 1 && groupName === AggGroupNames.Buckets}
        showValidation={formIsTouched || aggType.touched}
        setValue={onAggSelect}
        onChangeAggType={onChangeAggType}
      />

      {params.basic.map((param) => {
        const model = paramsState[param.aggParam.name] || {
          touched: false,
          valid: true,
        };

        return (
          // @ts-expect-error TS2322 TODO(ts-error): fixme
          <DefaultEditorAggParam
            key={`${param.aggParam.name}${agg.type ? agg.type.name : ''}`}
            disabled={disabledParams && disabledParams.includes(param.aggParam.name)}
            formIsTouched={formIsTouched}
            showValidation={formIsTouched || model.touched}
            setAggParamValue={setAggParamValue}
            onChangeParamsState={onChangeParamsState}
            {...param}
          />
        );
      })}

      {params.advanced.length ? (
        <>
          <EuiSpacer size="m" />
          <EuiAccordion
            id="advancedAccordion"
            data-test-subj={`advancedParams-${agg.id}`}
            buttonContent={i18n.translate('visDefaultEditor.advancedToggle.advancedLinkLabel', {
              defaultMessage: 'Advanced',
            })}
          >
            <EuiSpacer size="s" />
            {params.advanced.map((param) => {
              const model = paramsState[param.aggParam.name] || {
                touched: false,
                valid: true,
              };

              return (
                // @ts-expect-error TS2322 TODO(ts-error): fixme
                <DefaultEditorAggParam
                  key={`${param.aggParam.name}${agg.type ? agg.type.name : ''}`}
                  disabled={disabledParams && disabledParams.includes(param.aggParam.name)}
                  formIsTouched={formIsTouched}
                  showValidation={formIsTouched || model.touched}
                  setAggParamValue={setAggParamValue}
                  onChangeParamsState={onChangeParamsState}
                  {...param}
                />
              );
            })}
          </EuiAccordion>
        </>
      ) : null}
    </EuiForm>
  );
}

export { DefaultEditorAggParams };
