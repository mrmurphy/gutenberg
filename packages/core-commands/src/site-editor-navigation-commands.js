/**
 * WordPress dependencies
 */
import { useCommandLoader } from '@wordpress/commands';
import { __ } from '@wordpress/i18n';
import { useMemo, useEffect, useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	post,
	page,
	layout,
	symbolFilled,
	styles,
	navigation,
} from '@wordpress/icons';
import { privateApis as routerPrivateApis } from '@wordpress/router';
import { getQueryArg, addQueryArgs, getPath } from '@wordpress/url';
import { useDebounce } from '@wordpress/compose';

/**
 * Internal dependencies
 */
import { useIsBlockBasedTheme } from './hooks';
import { unlock } from './lock-unlock';
import { orderEntityRecordsBySearch } from './utils/order-entity-records-by-search';

const { useHistory, useLocation } = unlock( routerPrivateApis );

const icons = {
	post,
	page,
	wp_template: layout,
	wp_template_part: symbolFilled,
};

function useDebouncedValue( value ) {
	const [ debouncedValue, setDebouncedValue ] = useState( '' );
	const debounced = useDebounce( setDebouncedValue, 250 );

	useEffect( () => {
		debounced( value );
		return () => debounced.cancel();
	}, [ debounced, value ] );

	return debouncedValue;
}

const getNavigationCommandLoaderPerPostType = ( postType ) =>
	function useNavigationCommandLoader( { search } ) {
		const history = useHistory();
		const isBlockBasedTheme = useIsBlockBasedTheme();
		const delayedSearch = useDebouncedValue( search );
		const { records, isLoading } = useSelect(
			( select ) => {
				if ( ! delayedSearch ) {
					return {
						isLoading: false,
					};
				}

				const query = {
					search: delayedSearch,
					per_page: 10,
					orderby: 'relevance',
					status: [
						'publish',
						'future',
						'draft',
						'pending',
						'private',
					],
				};
				return {
					records: select( coreStore ).getEntityRecords(
						'postType',
						postType,
						query
					),
					isLoading: ! select( coreStore ).hasFinishedResolution(
						'getEntityRecords',
						[ 'postType', postType, query ]
					),
				};
			},
			[ delayedSearch ]
		);

		const commands = useMemo( () => {
			return ( records ?? [] ).map( ( record ) => {
				const command = {
					name: postType + '-' + record.id,
					searchLabel: record.title?.rendered + ' ' + record.id,
					label: record.title?.rendered
						? record.title?.rendered
						: __( '(no title)' ),
					icon: icons[ postType ],
				};

				if (
					postType === 'post' ||
					( postType === 'page' && ! isBlockBasedTheme )
				) {
					return {
						...command,
						callback: ( { close } ) => {
							const args = {
								post: record.id,
								action: 'edit',
							};
							const targetUrl = addQueryArgs( 'post.php', args );
							document.location = targetUrl;
							close();
						},
					};
				}

				const isSiteEditor = getPath( window.location.href )?.includes(
					'site-editor.php'
				);
				const extraArgs = isSiteEditor
					? {
							canvas: getQueryArg(
								window.location.href,
								'canvas'
							),
					  }
					: {};

				return {
					...command,
					callback: ( { close } ) => {
						const args = {
							postType,
							postId: record.id,
							...extraArgs,
						};
						const targetUrl = addQueryArgs(
							'site-editor.php',
							args
						);
						if ( isSiteEditor ) {
							history.push( args );
						} else {
							document.location = targetUrl;
						}
						close();
					},
				};
			} );
		}, [ records, isBlockBasedTheme, history ] );

		return {
			commands,
			isLoading,
		};
	};

const getNavigationCommandLoaderPerTemplate = ( templateType ) =>
	function useNavigationCommandLoader( { search } ) {
		const history = useHistory();
		const location = useLocation();

		const isPatternsPage =
			location?.params?.path === '/patterns' ||
			location?.params?.postType === 'wp_block';
		const didAccessPatternsPage =
			!! location?.params?.didAccessPatternsPage;

		const isBlockBasedTheme = useIsBlockBasedTheme();
		const { records, isLoading } = useSelect( ( select ) => {
			const { getEntityRecords } = select( coreStore );
			const query = { per_page: -1 };
			return {
				records: getEntityRecords( 'postType', templateType, query ),
				isLoading: ! select( coreStore ).hasFinishedResolution(
					'getEntityRecords',
					[ 'postType', templateType, query ]
				),
			};
		}, [] );

		/*
		 * wp_template and wp_template_part endpoints do not support per_page or orderby parameters.
		 * We need to sort the results based on the search query to avoid removing relevant
		 * records below using .slice().
		 */
		const orderedRecords = useMemo( () => {
			return orderEntityRecordsBySearch( records, search ).slice( 0, 10 );
		}, [ records, search ] );

		const commands = useMemo( () => {
			if (
				! isBlockBasedTheme &&
				! templateType === 'wp_template_part'
			) {
				return [];
			}
			return orderedRecords.map( ( record ) => {
				const isSiteEditor = getPath( window.location.href )?.includes(
					'site-editor.php'
				);
				const extraArgs = isSiteEditor
					? { canvas: getQueryArg( window.location.href, 'canvas' ) }
					: {};

				return {
					name: templateType + '-' + record.id,
					searchLabel: record.title?.rendered + ' ' + record.id,
					label: record.title?.rendered
						? record.title?.rendered
						: __( '(no title)' ),
					icon: icons[ templateType ],
					callback: ( { close } ) => {
						const args = {
							postType: templateType,
							postId: record.id,
							didAccessPatternsPage:
								! isBlockBasedTheme &&
								( isPatternsPage || didAccessPatternsPage )
									? 1
									: undefined,
							...extraArgs,
						};
						const targetUrl = addQueryArgs(
							'site-editor.php',
							args
						);
						if ( isSiteEditor ) {
							history.push( args );
						} else {
							document.location = targetUrl;
						}
						close();
					},
				};
			} );
		}, [ isBlockBasedTheme, orderedRecords, history ] );

		return {
			commands,
			isLoading,
		};
	};

const usePageNavigationCommandLoader =
	getNavigationCommandLoaderPerPostType( 'page' );
const usePostNavigationCommandLoader =
	getNavigationCommandLoaderPerPostType( 'post' );
const useTemplateNavigationCommandLoader =
	getNavigationCommandLoaderPerTemplate( 'wp_template' );
const useTemplatePartNavigationCommandLoader =
	getNavigationCommandLoaderPerTemplate( 'wp_template_part' );

function useSiteEditorBasicNavigationCommands() {
	const history = useHistory();
	const isSiteEditor = getPath( window.location.href )?.includes(
		'site-editor.php'
	);
	const canCreateTemplate = useSelect( ( select ) => {
		return select( coreStore ).canUser( 'create', 'templates' );
	}, [] );
	const isBlockBasedTheme = useIsBlockBasedTheme();
	const commands = useMemo( () => {
		const result = [];

		if ( ! canCreateTemplate || ! isBlockBasedTheme ) {
			return result;
		}

		result.push( {
			name: 'core/edit-site/open-navigation',
			label: __( 'Navigation' ),
			icon: navigation,
			callback: ( { close } ) => {
				const args = {
					path: '/navigation',
				};
				const targetUrl = addQueryArgs( 'site-editor.php', args );
				if ( isSiteEditor ) {
					history.push( args );
				} else {
					document.location = targetUrl;
				}
				close();
			},
		} );

		result.push( {
			name: 'core/edit-site/open-styles',
			label: __( 'Styles' ),
			icon: styles,
			callback: ( { close } ) => {
				const args = {
					path: '/wp_global_styles',
				};
				const targetUrl = addQueryArgs( 'site-editor.php', args );
				if ( isSiteEditor ) {
					history.push( args );
				} else {
					document.location = targetUrl;
				}
				close();
			},
		} );

		result.push( {
			name: 'core/edit-site/open-pages',
			label: __( 'Pages' ),
			icon: page,
			callback: ( { close } ) => {
				const args = {
					path: '/page',
				};
				const targetUrl = addQueryArgs( 'site-editor.php', args );
				if ( isSiteEditor ) {
					history.push( args );
				} else {
					document.location = targetUrl;
				}
				close();
			},
		} );

		result.push( {
			name: 'core/edit-site/open-templates',
			label: __( 'Templates' ),
			icon: layout,
			callback: ( { close } ) => {
				const args = {
					path: '/wp_template',
				};
				const targetUrl = addQueryArgs( 'site-editor.php', args );
				if ( isSiteEditor ) {
					history.push( args );
				} else {
					document.location = targetUrl;
				}
				close();
			},
		} );

		return result;
	}, [ history, isSiteEditor, canCreateTemplate, isBlockBasedTheme ] );

	return {
		commands,
		isLoading: false,
	};
}

export function useSiteEditorNavigationCommands() {
	useCommandLoader( {
		name: 'core/edit-site/navigate-pages',
		hook: usePageNavigationCommandLoader,
	} );
	useCommandLoader( {
		name: 'core/edit-site/navigate-posts',
		hook: usePostNavigationCommandLoader,
	} );
	useCommandLoader( {
		name: 'core/edit-site/navigate-templates',
		hook: useTemplateNavigationCommandLoader,
	} );
	useCommandLoader( {
		name: 'core/edit-site/navigate-template-parts',
		hook: useTemplatePartNavigationCommandLoader,
	} );
	useCommandLoader( {
		name: 'core/edit-site/basic-navigation',
		hook: useSiteEditorBasicNavigationCommands,
		context: 'site-editor',
	} );
}
