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

import React, { Component, RefObject, createRef } from 'react';
import { i18n } from '@osd/i18n';
import classNames from 'classnames';
import {
  EuiCompressedTextArea,
  EuiOutsideClickDetector,
  PopoverAnchorPosition,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiLink,
  htmlIdGenerator,
  EuiPortal,
  EuiText,
} from '@elastic/eui';

import { FormattedMessage } from '@osd/i18n/react';
import { debounce, compact, isEqual, isFunction } from 'lodash';
import { Toast } from 'src/core/public';
import { IDataPluginServices, IIndexPattern, IndexPattern, Query } from '../..';
import { QuerySuggestion, QuerySuggestionTypes } from '../../autocomplete';

import {
  OpenSearchDashboardsReactContextValue,
  toMountPoint,
} from '../../../../opensearch_dashboards_react/public';
import { fetchIndexPatterns } from './fetch_index_patterns';
import { QueryLanguageSwitcher } from './language_switcher';
import { PersistedLog, getQueryLog, matchPairs, toUser, fromUser } from '../../query';
import { SuggestionsListSize } from '../typeahead/suggestions_component';
import { SuggestionsComponent } from '..';

export interface QueryStringInputProps {
  indexPatterns: Array<IIndexPattern | string>;
  query: Query;
  disableAutoFocus?: boolean;
  screenTitle?: string;
  prepend?: any;
  persistedLog?: PersistedLog;
  bubbleSubmitEvent?: boolean;
  placeholder?: string;
  languageSwitcherPopoverAnchorPosition?: PopoverAnchorPosition;
  onBlur?: () => void;
  onChange?: (query: Query) => void;
  onChangeQueryInputFocus?: (isFocused: boolean) => void;
  onSubmit?: (query: Query) => void;
  dataTestSubj?: string;
  size?: SuggestionsListSize;
  className?: string;
  isInvalid?: boolean;
}

interface Props extends QueryStringInputProps {
  opensearchDashboards: OpenSearchDashboardsReactContextValue<IDataPluginServices>;
}

interface State {
  isSuggestionsVisible: boolean;
  index: number | null;
  suggestions: QuerySuggestion[];
  suggestionLimit: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  indexPatterns: IIndexPattern[];
  queryBarRect: DOMRect | undefined;
}

const KEY_CODES = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  ESC: 27,
  TAB: 9,
  HOME: 36,
  END: 35,
};

// Needed for React.lazy
// eslint-disable-next-line import/no-default-export
export default class QueryStringInputUI extends Component<Props, State> {
  public state: State = {
    isSuggestionsVisible: false,
    index: null,
    suggestions: [],
    suggestionLimit: 50,
    selectionStart: null,
    selectionEnd: null,
    indexPatterns: [],
    queryBarRect: undefined,
  };

  public inputRef: HTMLTextAreaElement | null = null;

  private persistedLog: PersistedLog | undefined;
  private abortController?: AbortController;
  private services = this.props.opensearchDashboards.services;
  private componentIsUnmounting = false;
  private queryBarInputDivRefInstance: RefObject<HTMLDivElement> = createRef();

  private getQueryString = () => {
    return toUser(this.props.query.query);
  };

  private fetchIndexPatterns = async () => {
    const stringPatterns = this.props.indexPatterns.filter(
      (indexPattern) => typeof indexPattern === 'string'
    ) as string[];
    const objectPatterns = this.props.indexPatterns.filter(
      (indexPattern) => typeof indexPattern !== 'string'
    ) as IIndexPattern[];

    const objectPatternsFromStrings = (await fetchIndexPatterns(
      this.services.savedObjects!.client,
      stringPatterns,
      this.services.uiSettings!
    )) as IIndexPattern[];

    this.setState({
      indexPatterns: [...objectPatterns, ...objectPatternsFromStrings],
    });
  };

  private getSuggestions = async () => {
    if (!this.inputRef) {
      return;
    }

    const language = this.props.query.language;
    const queryString = this.getQueryString();

    const recentSearchSuggestions = this.getRecentSearchSuggestions(queryString);
    const hasQuerySuggestions = this.services.data.autocomplete.hasQuerySuggestions(language);

    if (
      !hasQuerySuggestions ||
      !Array.isArray(this.state.indexPatterns) ||
      compact(this.state.indexPatterns).length === 0
    ) {
      return recentSearchSuggestions;
    }

    const indexPatterns = this.state.indexPatterns;

    const { selectionStart, selectionEnd } = this.inputRef;
    if (selectionStart === null || selectionEnd === null) {
      return;
    }

    try {
      if (this.abortController) this.abortController.abort();
      this.abortController = new AbortController();
      const suggestions =
        (await this.services.data.autocomplete.getQuerySuggestions({
          language,
          indexPattern: indexPatterns[0] as IndexPattern,
          query: queryString,
          selectionStart,
          selectionEnd,
          signal: this.abortController.signal,
        })) || [];
      return [...suggestions, ...recentSearchSuggestions];
    } catch (e) {
      // TODO: Waiting on https://github.com/elastic/kibana/issues/51406 for a properly typed error
      // Ignore aborted requests
      if (e.message === 'The user aborted a request.') return;
      throw e;
    }
  };

  private getRecentSearchSuggestions = (query: string) => {
    if (!this.persistedLog) {
      return [];
    }
    const recentSearches = this.persistedLog.get();
    const matchingRecentSearches = recentSearches.filter((recentQuery) => {
      const recentQueryString = typeof recentQuery === 'object' ? toUser(recentQuery) : recentQuery;
      return recentQueryString.includes(query);
    });
    return matchingRecentSearches.map((recentSearch) => {
      const text = toUser(recentSearch);
      const start = 0;
      const end = query.length;
      return { type: QuerySuggestionTypes.RecentSearch, text, start, end };
    });
  };

  private updateSuggestions = debounce(async () => {
    const suggestions = (await this.getSuggestions()) || [];
    if (!this.componentIsUnmounting) {
      this.setState({ suggestions });
    }
  }, 100);

  private onSubmit = (query: Query) => {
    if (this.props.onSubmit) {
      if (this.persistedLog) {
        this.persistedLog.add(query.query);
      }

      this.props.onSubmit({ query: fromUser(query.query), language: query.language });
    }
  };

  private onChange = (query: Query) => {
    this.updateSuggestions();

    if (this.props.onChange) {
      this.props.onChange({ query: fromUser(query.query), language: query.language });
    }
  };

  private onQueryStringChange = (value: string) => {
    this.setState({
      isSuggestionsVisible: true,
      index: null,
      suggestionLimit: 50,
    });

    this.onChange({ query: value, language: this.props.query.language });
  };

  private onInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.onQueryStringChange(event.target.value);
    if (event.target.value === '') {
      this.handleRemoveHeight();
    } else {
      this.handleAutoHeight();
    }
  };

  private onClickInput = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    if (event.target instanceof HTMLTextAreaElement) {
      this.onQueryStringChange(event.target.value);
    }
  };

  private onKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ([KEY_CODES.LEFT, KEY_CODES.RIGHT, KEY_CODES.HOME, KEY_CODES.END].includes(event.keyCode)) {
      this.setState({ isSuggestionsVisible: true });
      if (event.target instanceof HTMLTextAreaElement) {
        this.onQueryStringChange(event.target.value);
      }
    }
  };

  private onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.target instanceof HTMLTextAreaElement) {
      const { isSuggestionsVisible, index } = this.state;
      const preventDefault = event.preventDefault.bind(event);
      const { target, key, metaKey } = event;
      const { value, selectionStart, selectionEnd } = target;
      const updateQuery = (query: string, newSelectionStart: number, newSelectionEnd: number) => {
        this.onQueryStringChange(query);
        this.setState({
          selectionStart: newSelectionStart,
          selectionEnd: newSelectionEnd,
        });
      };

      switch (event.keyCode) {
        case KEY_CODES.DOWN:
          if (isSuggestionsVisible && index !== null) {
            event.preventDefault();
            this.incrementIndex(index);
            // Note to engineers. `isSuggestionVisible` does not mean the suggestions are visible.
            // This should likely be fixed, it's more that suggestions can be shown.
          } else if ((isSuggestionsVisible && index == null) || this.getQueryString() === '') {
            event.preventDefault();
            this.setState({ isSuggestionsVisible: true, index: 0 });
          }
          break;
        case KEY_CODES.UP:
          if (isSuggestionsVisible && index !== null) {
            event.preventDefault();
            this.decrementIndex(index);
          }
          break;
        case KEY_CODES.ENTER:
          if (!this.props.bubbleSubmitEvent) {
            event.preventDefault();
          }
          if (isSuggestionsVisible && index !== null && this.state.suggestions[index]) {
            event.preventDefault();
            this.selectSuggestion(this.state.suggestions[index]);
          } else {
            this.onSubmit(this.props.query);
            this.setState({
              isSuggestionsVisible: false,
            });
          }
          break;
        case KEY_CODES.ESC:
          event.preventDefault();
          this.setState({ isSuggestionsVisible: false, index: null });
          break;
        case KEY_CODES.TAB:
          this.setState({ isSuggestionsVisible: false, index: null });
          break;
        default:
          if (selectionStart !== null && selectionEnd !== null) {
            matchPairs({
              value,
              selectionStart,
              selectionEnd,
              key,
              metaKey,
              updateQuery,
              preventDefault,
            });
          }

          break;
      }
    }
  };

  private selectSuggestion = (suggestion: QuerySuggestion) => {
    if (!this.inputRef) {
      return;
    }
    // @ts-expect-error TS2339 TODO(ts-error): fixme
    const { type, text, start, end, cursorIndex } = suggestion;

    this.handleNestedFieldSyntaxNotification(suggestion);

    const query = this.getQueryString();
    const { selectionStart, selectionEnd } = this.inputRef;
    if (selectionStart === null || selectionEnd === null) {
      return;
    }

    const value = query.substr(0, selectionStart) + query.substr(selectionEnd);
    const newQueryString = value.substr(0, start) + text + value.substr(end);

    this.onQueryStringChange(newQueryString);

    this.setState({
      selectionStart: start + (cursorIndex ? cursorIndex : text.length),
      selectionEnd: start + (cursorIndex ? cursorIndex : text.length),
    });

    if (type === QuerySuggestionTypes.RecentSearch) {
      this.setState({ isSuggestionsVisible: false, index: null });
      this.onSubmit({ query: newQueryString, language: this.props.query.language });
    }
  };

  private handleNestedFieldSyntaxNotification = (suggestion: QuerySuggestion) => {
    if (
      'field' in suggestion &&
      suggestion.field.subType &&
      suggestion.field.subType.nested &&
      !this.services.storage.get('DQLNestedQuerySyntaxInfoOptOut')
    ) {
      const { notifications, docLinks } = this.services;

      const onDQLNestedQuerySyntaxInfoOptOut = (toast: Toast) => {
        if (!this.services.storage) return;
        this.services.storage.set('DQLNestedQuerySyntaxInfoOptOut', true);
        notifications!.toasts.remove(toast);
      };

      if (notifications && docLinks) {
        const toast = notifications.toasts.add({
          title: i18n.translate('data.query.queryBar.DQLNestedQuerySyntaxInfoTitle', {
            defaultMessage: 'DQL nested query syntax',
          }),
          text: toMountPoint(
            <div>
              <EuiText size="s">
                <p>
                  <FormattedMessage
                    id="data.query.queryBar.DQLNestedQuerySyntaxInfoText"
                    defaultMessage="It looks like you're querying on a nested field.
                  You can construct DQL syntax for nested queries in different ways, depending on the results you want.
                  Learn more in our {link}."
                    values={{
                      link: (
                        <EuiLink
                          href={docLinks.links.opensearchDashboards.dql.base}
                          target="_blank"
                        >
                          <FormattedMessage
                            id="data.query.queryBar.DQLNestedQuerySyntaxInfoDocLinkText"
                            defaultMessage="docs"
                          />
                        </EuiLink>
                      ),
                    }}
                  />
                </p>
              </EuiText>
              <EuiFlexGroup justifyContent="flexEnd" gutterSize="s">
                <EuiFlexItem grow={false}>
                  <EuiButton size="s" onClick={() => onDQLNestedQuerySyntaxInfoOptOut(toast)}>
                    <FormattedMessage
                      id="data.query.queryBar.DQLNestedQuerySyntaxInfoOptOutText"
                      defaultMessage="Don't show again"
                    />
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </div>
          ),
        });
      }
    }
  };

  private increaseLimit = () => {
    this.setState({
      suggestionLimit: this.state.suggestionLimit + 50,
    });
  };

  private incrementIndex = (currentIndex: number) => {
    let nextIndex = currentIndex + 1;
    if (currentIndex === null || nextIndex >= this.state.suggestions.length) {
      nextIndex = 0;
    }
    this.setState({ index: nextIndex });
  };

  private decrementIndex = (currentIndex: number) => {
    const previousIndex = currentIndex - 1;
    if (previousIndex < 0) {
      this.setState({ index: this.state.suggestions.length - 1 });
    } else {
      this.setState({ index: previousIndex });
    }
  };

  private onSelectLanguage = (language: string) => {
    // Send telemetry info every time the user opts in or out of kuery
    // As a result it is important this function only ever gets called in the
    // UI component's change handler.
    this.services.http.post('/api/opensearch-dashboards/dql_opt_in_stats', {
      body: JSON.stringify({ opt_in: language === 'kuery' }),
    });

    // Update local storage
    this.services.storage.set('userQueryLanguage', language);
    this.services.data.query.queryString.getInitialQueryByLanguage(language);

    const newQuery = { query: '', language };
    this.onChange(newQuery);
    this.onSubmit(newQuery);
  };

  private onOutsideClick = () => {
    if (this.state.isSuggestionsVisible) {
      this.setState({ isSuggestionsVisible: false, index: null });
    }
    this.handleBlurHeight();
    if (this.props.onChangeQueryInputFocus) {
      this.props.onChangeQueryInputFocus(false);
    }
  };

  private onInputBlur = () => {
    this.handleBlurHeight();
    if (this.props.onChangeQueryInputFocus) {
      this.props.onChangeQueryInputFocus(false);
    }
    if (isFunction(this.props.onBlur)) {
      this.props.onBlur();
    }
  };

  private onClickSuggestion = (suggestion: QuerySuggestion) => {
    if (!this.inputRef) {
      return;
    }
    this.selectSuggestion(suggestion);
    this.inputRef.focus();
  };

  private initPersistedLog = () => {
    const { uiSettings, storage, appName } = this.services;
    this.persistedLog = this.props.persistedLog
      ? this.props.persistedLog
      : getQueryLog(uiSettings, storage, appName, this.props.query.language);
  };

  public onMouseEnterSuggestion = (index: number) => {
    this.setState({ index });
  };

  textareaId = htmlIdGenerator()();

  public componentDidMount() {
    const parsedQuery = fromUser(toUser(this.props.query.query));
    if (!isEqual(this.props.query.query, parsedQuery)) {
      this.onChange({ ...this.props.query, query: parsedQuery });
    }

    this.initPersistedLog();
    this.fetchIndexPatterns().then(this.updateSuggestions);
    this.handleListUpdate();

    window.addEventListener('resize', this.handleAutoHeight);
    window.addEventListener('scroll', this.handleListUpdate, {
      passive: true, // for better performance as we won't call preventDefault
      capture: true, // scroll events don't bubble, they must be captured instead
    });
  }

  public componentDidUpdate(prevProps: Props) {
    const parsedQuery = fromUser(toUser(this.props.query.query));
    if (!isEqual(this.props.query.query, parsedQuery)) {
      this.onChange({ ...this.props.query, query: parsedQuery });
    }

    this.initPersistedLog();

    if (!isEqual(prevProps.indexPatterns, this.props.indexPatterns)) {
      this.fetchIndexPatterns().then(this.updateSuggestions);
    } else if (!isEqual(prevProps.query, this.props.query)) {
      this.updateSuggestions();
    }

    if (this.state.selectionStart !== null && this.state.selectionEnd !== null) {
      if (this.inputRef != null) {
        this.inputRef.setSelectionRange(this.state.selectionStart, this.state.selectionEnd);
      }
      this.setState({
        selectionStart: null,
        selectionEnd: null,
      });
      if (document.activeElement !== null && document.activeElement.id === this.textareaId) {
        this.handleAutoHeight();
      } else {
        this.handleRemoveHeight();
      }
    }
  }

  public componentWillUnmount() {
    if (this.abortController) this.abortController.abort();
    if (this.updateSuggestions.cancel) this.updateSuggestions.cancel();
    this.componentIsUnmounting = true;
    window.removeEventListener('resize', this.handleAutoHeight);
    window.removeEventListener('scroll', this.handleListUpdate, { capture: true });
  }

  handleListUpdate = () => {
    if (this.componentIsUnmounting) return;

    return this.setState({
      queryBarRect: this.queryBarInputDivRefInstance.current?.getBoundingClientRect(),
    });
  };

  handleAutoHeight = () => {
    if (this.inputRef !== null && document.activeElement === this.inputRef) {
      this.inputRef.style.setProperty('height', `${this.inputRef.scrollHeight}px`, 'important');
    }
    this.handleListUpdate();
  };

  handleRemoveHeight = () => {
    if (this.inputRef !== null) {
      this.inputRef.style.removeProperty('height');
    }
  };

  handleBlurHeight = () => {
    if (this.inputRef !== null) {
      this.handleRemoveHeight();
      this.inputRef.scrollTop = 0;
    }
  };

  handleOnFocus = () => {
    if (this.props.onChangeQueryInputFocus) {
      this.props.onChangeQueryInputFocus(true);
    }
    requestAnimationFrame(() => {
      this.handleAutoHeight();
    });
  };

  public render() {
    const isSuggestionsVisible = this.state.isSuggestionsVisible && {
      'aria-controls': 'osdTypeahead__items',
      'aria-owns': 'osdTypeahead__items',
    };
    const ariaCombobox = { ...isSuggestionsVisible, role: 'combobox' };
    const className = classNames(
      'euiFormControlLayout euiFormControlLayout--group euiFormControlLayout--compressed osdQueryBar__wrap',
      this.props.className
    );

    return (
      <div className={className}>
        {this.props.prepend}
        <EuiOutsideClickDetector onOutsideClick={this.onOutsideClick}>
          <div
            {...ariaCombobox}
            style={{ position: 'relative', width: '100%' }}
            aria-label={i18n.translate('data.query.queryBar.comboboxAriaLabel', {
              defaultMessage: 'Search and filter the {pageType} page',
              values: { pageType: this.services.appName },
            })}
            aria-haspopup="true"
            aria-expanded={this.state.isSuggestionsVisible}
            data-skip-axe="aria-required-children"
          >
            <div
              role="search"
              className="euiFormControlLayout__childrenWrapper osdQueryBar__textareaWrap"
              data-test-subj="queryBarInputContainer"
              ref={this.queryBarInputDivRefInstance}
            >
              <EuiCompressedTextArea
                placeholder={
                  this.props.placeholder ||
                  i18n.translate('data.query.queryBar.searchInputPlaceholder', {
                    defaultMessage: 'Search',
                  })
                }
                value={this.getQueryString()}
                onKeyDown={this.onKeyDown}
                onKeyUp={this.onKeyUp}
                onChange={this.onInputChange}
                onClick={this.onClickInput}
                onBlur={this.onInputBlur}
                onFocus={this.handleOnFocus}
                className="osdQueryBar__textarea"
                fullWidth
                rows={1}
                id={this.textareaId}
                autoFocus={
                  this.props.onChangeQueryInputFocus ? false : !this.props.disableAutoFocus
                }
                inputRef={(node: any) => {
                  if (node) {
                    this.inputRef = node;
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label={i18n.translate('data.query.queryBar.searchInputAriaLabel', {
                  defaultMessage: 'Start typing to search and filter the {pageType} page',
                  values: { pageType: this.services.appName },
                })}
                aria-autocomplete="list"
                aria-controls={this.state.isSuggestionsVisible ? 'osdTypeahead__items' : undefined}
                aria-activedescendant={
                  this.state.isSuggestionsVisible && typeof this.state.index === 'number'
                    ? `suggestion-${this.state.index}`
                    : undefined
                }
                role="textbox"
                data-test-subj={this.props.dataTestSubj || 'queryInput'}
                isInvalid={this.props.isInvalid}
              >
                {this.getQueryString()}
              </EuiCompressedTextArea>
            </div>
            <EuiPortal>
              <SuggestionsComponent
                show={this.state.isSuggestionsVisible}
                suggestions={this.state.suggestions.slice(0, this.state.suggestionLimit)}
                index={this.state.index}
                onClick={this.onClickSuggestion}
                onMouseEnter={this.onMouseEnterSuggestion}
                loadMore={this.increaseLimit}
                queryBarRect={this.state.queryBarRect}
                size={this.props.size}
              />
            </EuiPortal>
          </div>
        </EuiOutsideClickDetector>

        <QueryLanguageSwitcher
          language={this.props.query.language}
          anchorPosition={this.props.languageSwitcherPopoverAnchorPosition}
          onSelectLanguage={this.onSelectLanguage}
        />
      </div>
    );
  }
}
